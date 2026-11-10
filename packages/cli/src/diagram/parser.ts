/**
 * Terminal Diagram Parser.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 5, § 21).
 *
 * Requirements:
 * - Parses: graph/flowchart, sequenceDiagram, stateDiagram, erDiagram.
 * - Separates diagram parser from painter.
 * - Extracts nodes, subgraphs, arrows, labels (handles <br/>), and style classes.
 * - Ignores classDef, style, linkStyle (theme controls colors).
 */

export type DiagramType = 'flowchart' | 'sequence' | 'state' | 'er' | 'unsupported';

export type NodeShape = 'box' | 'diamond' | 'stadium' | 'rounded' | 'cylinder' | 'double_box';

export interface DiagramNode {
  id: string;
  label: string;
  shape: NodeShape;
  styleClass?: 'function' | 'class' | 'file' | 'directory' | 'external' | 'focal' | string;
  subgraphId?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dotted' | 'thick';
}

export interface DiagramSubgraph {
  id: string;
  title: string;
  nodes: string[];
}

export interface ParsedDiagram {
  type: DiagramType;
  rawSource: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  subgraphs: DiagramSubgraph[];
  isValid: boolean;
  error?: string;
}

export function detectDiagramType(source: string): DiagramType {
  const firstLine = source.trim().split('\n')[0].trim().toLowerCase();
  if (firstLine.startsWith('graph') || firstLine.startsWith('flowchart')) {
    return 'flowchart';
  }
  if (firstLine.startsWith('sequencediagram')) {
    return 'sequence';
  }
  if (firstLine.startsWith('statediagram') || firstLine.startsWith('statediagram-v2')) {
    return 'state';
  }
  if (firstLine.startsWith('erdiagram')) {
    return 'er';
  }
  return 'unsupported';
}

export function parseDiagram(source: string): ParsedDiagram {
  const trimmed = source.trim();
  const type = detectDiagramType(trimmed);

  if (type === 'unsupported') {
    return {
      type: 'unsupported',
      rawSource: source,
      nodes: [],
      edges: [],
      subgraphs: [],
      isValid: false,
      error: 'Unsupported diagram syntax header. Supported: graph, flowchart, sequenceDiagram, stateDiagram, erDiagram.',
    };
  }

  const lines = trimmed.split('\n');
  const nodesMap = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const subgraphs: DiagramSubgraph[] = [];
  let currentSubgraph: DiagramSubgraph | null = null;

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('%%')) continue;

    // Ignore classDef, style, linkStyle per § 5.2
    if (
      rawLine.startsWith('classDef') ||
      rawLine.startsWith('style ') ||
      rawLine.startsWith('linkStyle')
    ) {
      continue;
    }

    // Subgraphs (§ 5.2)
    if (rawLine.startsWith('subgraph ')) {
      const title = rawLine.replace(/^subgraph\s+/, '').replace(/[[\]]/g, '').trim();
      currentSubgraph = {
        id: `sub_${subgraphs.length + 1}`,
        title,
        nodes: [],
      };
      subgraphs.push(currentSubgraph);
      continue;
    }

    if (rawLine === 'end') {
      currentSubgraph = null;
      continue;
    }

    // Match class assignment: class nodeA function
    const classMatch = rawLine.match(/^class\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)/);
    if (classMatch) {
      const [, nodeId, styleClass] = classMatch;
      const existing = nodesMap.get(nodeId);
      if (existing) {
        existing.styleClass = styleClass;
      }
      continue;
    }

    // Edge matching: A --> B or A -->|label| B or A --- B or A -.-> B
    const connectorMatch = rawLine.match(/\s*(-->|---|-\.->|==>)(?:\|([^|]+)\|)?\s*/);
    if (connectorMatch && connectorMatch.index !== undefined && connectorMatch.index > 0) {
      const connector = connectorMatch[1];
      const edgeLabel = connectorMatch[2];
      const rawFrom = rawLine.slice(0, connectorMatch.index).trim();
      const rawTo = rawLine.slice(connectorMatch.index + connectorMatch[0].length).trim();

      if (rawFrom && rawTo) {
        const fromNode = parseNodeDef(rawFrom, currentSubgraph?.id);
        const toNode = parseNodeDef(rawTo, currentSubgraph?.id);

        if (!nodesMap.has(fromNode.id)) nodesMap.set(fromNode.id, fromNode);
        if (!nodesMap.has(toNode.id)) nodesMap.set(toNode.id, toNode);

        if (currentSubgraph) {
          if (!currentSubgraph.nodes.includes(fromNode.id)) currentSubgraph.nodes.push(fromNode.id);
          if (!currentSubgraph.nodes.includes(toNode.id)) currentSubgraph.nodes.push(toNode.id);
        }

        edges.push({
          from: fromNode.id,
          to: toNode.id,
          label: edgeLabel?.trim(),
          style: connector === '-.->' ? 'dotted' : connector === '==>' ? 'thick' : 'solid',
        });
        continue;
      }
    }

    // Single node definition: A[label] or A{label} or A(label)
    if (rawLine.includes('[') || rawLine.includes('{') || rawLine.includes('(')) {
      const singleNode = parseNodeDef(rawLine, currentSubgraph?.id);
      if (!nodesMap.has(singleNode.id)) {
        nodesMap.set(singleNode.id, singleNode);
        if (currentSubgraph) currentSubgraph.nodes.push(singleNode.id);
      }
    }
  }

  return {
    type,
    rawSource: source,
    nodes: Array.from(nodesMap.values()),
    edges,
    subgraphs,
    isValid: true,
  };
}

function parseNodeDef(def: string, subgraphId?: string): DiagramNode {
  const trimmed = def.trim();

  // Diamond: id{label}
  let match = trimmed.match(/^([A-Za-z0-9_]+)\{([^}]+)\}/);
  if (match) {
    return {
      id: match[1],
      label: cleanLabel(match[2]),
      shape: 'diamond',
      subgraphId,
    };
  }

  // Stadium / Rounded: id([label]) or id(label)
  match = trimmed.match(/^([A-Za-z0-9_]+)\(\[([^\]]+)\]\)/);
  if (match) {
    return {
      id: match[1],
      label: cleanLabel(match[2]),
      shape: 'stadium',
      subgraphId,
    };
  }

  match = trimmed.match(/^([A-Za-z0-9_]+)\(([^)]+)\)/);
  if (match) {
    return {
      id: match[1],
      label: cleanLabel(match[2]),
      shape: 'rounded',
      subgraphId,
    };
  }

  // Box: id[label]
  match = trimmed.match(/^([A-Za-z0-9_]+)\[([^\]]+)\]/);
  if (match) {
    return {
      id: match[1],
      label: cleanLabel(match[2]),
      shape: 'box',
      subgraphId,
    };
  }

  // Plain identifier: id
  const plainId = trimmed.replace(/[^A-Za-z0-9_]/g, '');
  return {
    id: plainId,
    label: plainId,
    shape: 'box',
    subgraphId,
  };
}

function cleanLabel(raw: string): string {
  // Replace <br/> with newline (§ 5.2)
  return raw.replace(/<br\s*\/?>/gi, '\n').replace(/["']/g, '').trim();
}
