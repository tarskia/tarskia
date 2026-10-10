#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "graphifyy==0.6.7",
# ]
# ///
from __future__ import annotations

import argparse
import json
import traceback
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from graphify.extract import collect_files, extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json


GRAPHIFY_PACKAGE = "graphifyy==0.6.7"


def relative_to_repo(repo_root: Path, value):
    if value is None:
        return None
    raw = str(value)
    if not raw:
        return None
    path = Path(raw)
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except Exception:
        return raw.replace("\\", "/")


def normalize_source_locations(repo_root: Path, extraction: dict) -> dict:
    for node in extraction.get("nodes", []):
        if isinstance(node, dict):
            node["source_file"] = relative_to_repo(repo_root, node.get("source_file"))
    for edge in extraction.get("edges", []):
        if isinstance(edge, dict):
            edge["source_file"] = relative_to_repo(repo_root, edge.get("source_file"))
    return extraction


def node_hint(G, node_id: str) -> dict:
    data = G.nodes[node_id]
    return {
        "id": node_id,
        "label": data.get("label", node_id),
        "degree": G.degree(node_id),
        "sourceFile": data.get("source_file") or None,
        "sourceLocation": data.get("source_location") or None,
        "community": data.get("community") if data.get("community") is not None else None,
    }


def relation_hint(G, source_id: str, target_id: str, data: dict) -> dict:
    directed_source = data.get("_src", source_id)
    directed_target = data.get("_tgt", target_id)
    source_data = G.nodes.get(directed_source, {})
    target_data = G.nodes.get(directed_target, {})
    return {
        "sourceId": directed_source,
        "sourceLabel": source_data.get("label", directed_source),
        "targetId": directed_target,
        "targetLabel": target_data.get("label", directed_target),
        "relation": data.get("relation", "related_to"),
        "confidence": data.get("confidence", "EXTRACTED"),
        "confidenceScore": data.get("confidence_score", data.get("weight")),
        "sourceFile": data.get("source_file") or None,
        "sourceLocation": data.get("source_location") or None,
    }


def summarize_communities(G, communities: dict, cohesion: dict) -> list[dict]:
    summaries = []
    for cid, node_ids in communities.items():
        ranked_nodes = sorted(node_ids, key=lambda node_id: G.degree(node_id), reverse=True)
        files = Counter()
        relations = Counter()
        node_set = set(node_ids)
        for node_id in node_ids:
            source_file = G.nodes[node_id].get("source_file")
            if source_file:
                files[source_file] += 1
        for left, right, data in G.edges(data=True):
            if left in node_set and right in node_set:
                relations[data.get("relation", "related_to")] += 1
        summaries.append({
            "id": int(cid),
            "size": len(node_ids),
            "cohesion": cohesion.get(cid),
            "representativeNodes": [node_hint(G, node_id) for node_id in ranked_nodes[:8]],
            "sourceFiles": [item for item, _ in files.most_common(8)],
            "relationTypes": [item for item, _ in relations.most_common(8)],
        })
    return sorted(summaries, key=lambda item: (-item["size"], item["id"]))[:12]


def bridge_nodes(G) -> list[dict]:
    if G.number_of_edges() == 0:
        return []
    import networkx as nx
    k = min(100, G.number_of_nodes()) if G.number_of_nodes() > 1000 else None
    scores = nx.betweenness_centrality(G, k=k, seed=42)
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    hints = []
    for node_id, score in ranked:
        data = G.nodes[node_id]
        if data.get("file_type") == "file":
            continue
        hint = node_hint(G, node_id)
        hint["betweenness"] = round(float(score), 6)
        hints.append(hint)
        if len(hints) >= 10:
            break
    return hints


def relation_summaries(G, confidence: str, limit: int) -> list[dict]:
    relations = [
        relation_hint(G, left, right, data)
        for left, right, data in G.edges(data=True)
        if data.get("confidence", "EXTRACTED") == confidence
    ]
    return sorted(
        relations,
        key=lambda item: (
            item.get("sourceFile") or "",
            item.get("sourceLocation") or "",
            item["sourceLabel"],
            item["targetLabel"],
        ),
    )[:limit]


def render_summary_markdown(hints: dict) -> str:
    lines = [
        "# Graphify Code-Structure Hints",
        "",
        "Use these hints as repository evidence, not required diagram nodes.",
        "Prefer EXTRACTED relations over INFERRED relations.",
        "Map code-level nodes into architecture concepts only when they represent runtime boundaries, flow carriers, storage, protocol surfaces, or meaningful shared kernels.",
        "",
        "## Corpus",
        f"- Code files: {hints['corpus']['codeFiles']}",
        f"- Graph: {hints['corpus']['nodes']} nodes, {hints['corpus']['edges']} edges, {hints['corpus']['communities']} communities",
        f"- Edge confidence: {hints['corpus']['extractedEdges']} EXTRACTED, {hints['corpus']['inferredEdges']} INFERRED, {hints['corpus']['ambiguousEdges']} AMBIGUOUS",
        "",
        "## Central Nodes",
    ]
    if hints["centralNodes"]:
        for node in hints["centralNodes"]:
            location = f" ({node.get('sourceFile') or 'unknown'}:{node.get('sourceLocation') or '?'})"
            lines.append(f"- {node['label']} [{node['id']}] degree={node.get('degree', 0)}{location}")
    else:
        lines.append("- None")

    lines.extend(["", "## Communities"])
    if hints["communities"]:
        for community in hints["communities"]:
            representatives = ", ".join(node["label"] for node in community["representativeNodes"][:5]) or "none"
            files = ", ".join(community["sourceFiles"][:4]) or "unknown files"
            lines.append(f"- Community {community['id']}: {community['size']} nodes; representatives: {representatives}; source files: {files}")
    else:
        lines.append("- None")

    lines.extend(["", "## Bridge Nodes"])
    if hints["bridgeNodes"]:
        for node in hints["bridgeNodes"]:
            lines.append(f"- {node['label']} [{node['id']}] betweenness={node.get('betweenness')}")
    else:
        lines.append("- None")

    lines.extend(["", "## High-Confidence Extracted Relations"])
    if hints["extractedRelations"]:
        for relation in hints["extractedRelations"]:
            location = f" ({relation.get('sourceFile') or 'unknown'}:{relation.get('sourceLocation') or '?'})"
            lines.append(f"- {relation['sourceLabel']} --{relation['relation']}--> {relation['targetLabel']}{location}")
    else:
        lines.append("- None")

    lines.extend(["", "## Advisory Inferred Relations"])
    if hints["inferredRelations"]:
        for relation in hints["inferredRelations"]:
            score = relation.get("confidenceScore")
            score_suffix = f" score={score}" if score is not None else ""
            lines.append(f"- {relation['sourceLabel']} --{relation['relation']}--> {relation['targetLabel']}{score_suffix}")
    else:
        lines.append("- None")

    if hints["warnings"]:
        lines.extend(["", "## Warnings"])
        for warning in hints["warnings"]:
            lines.append(f"- {warning}")

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--summary-json", required=True)
    parser.add_argument("--summary-md", required=True)
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    out_dir = Path(args.out_dir).resolve()
    summary_json = Path(args.summary_json).resolve()
    summary_md = Path(args.summary_md).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    summary_json.parent.mkdir(parents=True, exist_ok=True)
    warnings = []

    try:
        code_files = collect_files(repo_root, root=repo_root)
        extraction = extract(code_files, cache_root=out_dir)
        extraction = normalize_source_locations(repo_root, extraction)
        extraction_path = out_dir / "extraction.json"
        extraction_path.write_text(json.dumps(extraction, indent=2), encoding="utf-8")

        G = build_from_json(extraction)
        communities = cluster(G)
        cohesion = score_all(G, communities)
        for cid, node_ids in communities.items():
            for node_id in node_ids:
                if node_id in G.nodes:
                    G.nodes[node_id]["community"] = int(cid)

        central_nodes = god_nodes(G, top_n=10)
        central_hints = []
        for node in central_nodes:
            node_id = node["id"]
            hint = node_hint(G, node_id)
            hint["degree"] = node.get("degree", hint.get("degree"))
            central_hints.append(hint)

        surprises = surprising_connections(G, communities, top_n=10)
        for surprise in surprises:
            if isinstance(surprise, dict) and surprise.get("confidence") == "AMBIGUOUS":
                warnings.append(f"Ambiguous Graphify relation: {surprise}")

        labels = {cid: f"Community {cid}" for cid in communities}
        questions = suggest_questions(G, communities, labels)
        detection_result = {
            "total_files": len(code_files),
            "total_words": 0,
        }
        report = generate(
            G,
            communities,
            cohesion,
            labels,
            central_nodes,
            surprises,
            detection_result,
            {"input": 0, "output": 0},
            str(repo_root),
            suggested_questions=questions,
        )
        report_path = out_dir / "GRAPH_REPORT.md"
        report_path.write_text(report, encoding="utf-8")
        graph_path = out_dir / "graph.json"
        to_json(G, communities, str(graph_path), force=True)

        confidences = Counter(data.get("confidence", "EXTRACTED") for _, _, data in G.edges(data=True))
        hints = {
            "version": 1,
            "status": "available",
            "mode": "code-only",
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "graphifyPackage": GRAPHIFY_PACKAGE,
            "corpus": {
                "codeFiles": len(code_files),
                "nodes": G.number_of_nodes(),
                "edges": G.number_of_edges(),
                "communities": len(communities),
                "extractedEdges": confidences.get("EXTRACTED", 0),
                "inferredEdges": confidences.get("INFERRED", 0),
                "ambiguousEdges": confidences.get("AMBIGUOUS", 0),
            },
            "centralNodes": central_hints,
            "communities": summarize_communities(G, communities, cohesion),
            "bridgeNodes": bridge_nodes(G),
            "extractedRelations": relation_summaries(G, "EXTRACTED", 20),
            "inferredRelations": relation_summaries(G, "INFERRED", 10),
            "warnings": warnings,
            "artifacts": {
                "graphJson": "analysis/graphify/graph.json",
                "extractionJson": "analysis/graphify/extraction.json",
                "reportMarkdown": "analysis/graphify/GRAPH_REPORT.md",
                "summaryMarkdown": "analysis/graphify-hints.md",
            },
        }
        markdown = render_summary_markdown(hints)
        hints["summaryMarkdown"] = markdown
        summary_md.write_text(markdown, encoding="utf-8")
        summary_json.write_text(json.dumps(hints, indent=2), encoding="utf-8")
        print(json.dumps({"status": "available", "nodes": G.number_of_nodes(), "edges": G.number_of_edges(), "communities": len(communities)}))
        return 0
    except Exception as exc:
        failure = {
            "status": "failed",
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }
        (out_dir / "failure.json").write_text(json.dumps(failure, indent=2), encoding="utf-8")
        raise


if __name__ == "__main__":
    raise SystemExit(main())
