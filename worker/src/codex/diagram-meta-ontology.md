# Tarskia Diagram Meta-Ontology

## Purpose

A Tarskia diagram is not primarily a dump of discovered objects.
It is a projection of a system intended to explain how data moves through it.

The default goal is to show the main flow of data through an application or infrastructure.
Completeness matters less than coherence.
A diagram that omits some helper details but preserves the flow is usually better than a diagram that is exhaustive but unreadable.

## What The User Sees

The user ultimately sees:
- nodes
- nested boundaries
- edges between visible nodes
- expanded or collapsed views of those nodes

Therefore we should model for projection, not just extraction.
A thing should appear in the diagram when it helps explain the system as consumed by a human.

## Flow First

For most application and runtime diagrams, the primary semantic is flow.

Usually:
- something enters a node
- the node transforms, routes, stores, or emits it
- something leaves the node

This does not mean every node must be perfectly symmetric.
A source may mainly emit.
A sink may mainly receive.
A store may mainly be read from, written to, or both.
Some boundary concepts may legitimately terminate the visible flow at the current scope even when continuation beyond them is real but out of scope.

But most nodes shown in an application flow diagram should sit on or near a meaningful path.
If a node is not part of the flow, it should usually not be promoted into the main diagram by default.

## Nodes

A node is something we want the user to reason about.

Common node kinds include:
- applications
- services
- APIs
- modules
- jobs
- queues, topics, and subscriptions
- datastores
- external systems

A node is justified when at least one of these is true:
- it is a clear boundary
- it is a meaningful transformation step in the flow
- it is a meaningful endpoint of the flow
- it is needed to preserve causal continuity in the user's mental model

A library, helper, or utility is not automatically a node.
It becomes a node only when it acts like a boundary or a meaningful flow step.

## Boundaries and Containment

Containment is structural, not a flow relation.

Parents and children define nesting.
A diagram should use boundaries and grouping to show containment.
It should not normally draw a visible `contains` edge.

A boundary says:
- these things belong together
- this is a unit the user can collapse or expand
- this unit has meaningful ingress and egress relative to the rest of the system

## Expansion

Expansion should refine a boundary, not dissolve it.

When a collapsed node is expanded:
- its external ingress should connect to more specific internal entry points
- its external egress should connect to more specific internal exit points
- internal nodes shown should mostly lie on the path between those entry and exit points

Expansion is not an invitation to show every helper or implementation detail.
If an internal node is not relevant to the flow through the expanded boundary, it should usually remain hidden.

## External Concepts

A coherent diagram may include nodes that are not directly declared as first-class entities in the source, when they are strongly implied and needed to complete the flow.

Common examples:
- a database inferred from configuration or ORM usage
- an external API inferred from a stable client or base URL
- a queue or topic inferred from producer or consumer configuration

The aim is not speculative world-building.
The aim is to complete an obviously real path when the evidence is strong.
Some externals and user-facing boundaries are also valid stopping points when continuation is not visible.

Prefer:
- one clear external boundary

Over:
- several weak internal helper nodes that obscure the endpoint

## Stores and Access

Stores are usually means to an end, not flow-through actors in the same sense as modules or services.

Their semantic importance is in access patterns:
- reads
- writes
- read-writes

A store often participates in a flow by serving as a source, sink, or persistence boundary for other nodes.
A data model inside a store may be worth showing when that level of detail is relevant.

## Levels of Detail

A diagram should privilege the level of detail that best explains the system.

At outline level:
- prefer major boundaries and major flow steps
- include high-confidence external endpoints when they complete the story
- avoid helper modules and incidental libraries

At expanded level:
- reveal the internal path through the chosen boundary
- preserve correspondence with the boundary's original external flow
- show detail only where it explains the movement or transformation of data

## Provenance

Every node and edge should be defensible.

If something is directly observed, it should be attributable to a concrete source.
If something is added to complete the diagram, its provenance should still be explainable:
- configuration
- ORM schema
- client definition
- import usage
- base URL
- migration or schema artifact
- other strong evidence

The user should be able to understand why the diagram contains a thing.

## Defaults

Prefer:
- coherent end-to-end flow
- visible boundaries
- meaningful transformations
- major stores and external systems
- expansion that refines rather than explodes

Avoid:
- showing containment as an edge
- truncating the flow at internal implementation details
- promoting every helper into the main path
- expanding a node into a bag of unrelated internals
- treating literal extraction as the goal

## Worker Heuristic

When building a diagram, the worker should ask:

1. What is the main data flow here?
2. Which nodes are required for that flow to make sense to a human?
3. Which boundaries should stay collapsed?
4. If a node is expanded, what is the internal path through it?
5. Is there an external concept that must be shown to complete the flow?
6. Which discovered details are real but not helpful at this level?

The worker should optimize for a diagram that a user can read and trust, not for maximum extracted surface area.
