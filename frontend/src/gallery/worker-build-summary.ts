import type { DtoGalleryDiagramSummaryResponse } from '../api/generated/model';

type GalleryWorkerBuild = DtoGalleryDiagramSummaryResponse['workerBuild'];

export function formatCompactNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    const scaled = value / 1_000_000_000;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')}B`;
  }
  if (absolute >= 1_000_000) {
    const scaled = value / 1_000_000;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (absolute >= 1_000) {
    const scaled = value / 1_000;
    return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${value}`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function formatWorkerBuildFacts(workerBuild: GalleryWorkerBuild): string[] {
  if (!workerBuild) {
    return [];
  }
  const facts: string[] = [];
  if (workerBuild.model?.trim()) {
    facts.push(workerBuild.model.trim());
  }
  if (typeof workerBuild.durationMs === 'number' && workerBuild.durationMs > 0) {
    facts.push(formatDuration(workerBuild.durationMs));
  }
  if (typeof workerBuild.approxTotalTokens === 'number' && workerBuild.approxTotalTokens > 0) {
    facts.push(`${formatCompactNumber(workerBuild.approxTotalTokens)} tok`);
  }
  if (typeof workerBuild.turns === 'number' && workerBuild.turns > 0) {
    facts.push(`${workerBuild.turns} turn${workerBuild.turns === 1 ? '' : 's'}`);
  }
  return facts;
}
