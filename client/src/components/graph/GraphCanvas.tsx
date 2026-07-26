'use client'

import {
  SigmaContainer,
  useLoadGraph,
  useRegisterEvents,
  useSetSettings,
  useSigma,
} from '@react-sigma/core'
import { UndirectedGraph } from 'graphology'
import { useEffect, useMemo } from 'react'

import type { GraphPath, SnapshotEdge, SnapshotNode } from '@/lib/graph/types'

const nodeColours: Record<SnapshotNode['type'], string> = {
  incident: '#38BDF8',
  person: '#FFC53D',
  vehicle: '#2DD4BF',
  phone: '#A78BFA',
  account: '#FB7185',
}

interface GraphStageProps {
  readonly nodes: readonly SnapshotNode[]
  readonly edges: readonly SnapshotEdge[]
  readonly selectedNodeId: string | null
  readonly selectedEdgeId: string | null
  readonly path: GraphPath | null
  readonly focusNodeId: string | null
  readonly onNode: (nodeId: string) => void
  readonly onEdge: (edgeId: string) => void
  readonly onClear: () => void
}

function GraphStage({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
  path,
  focusNodeId,
  onNode,
  onEdge,
  onClear,
}: GraphStageProps) {
  const loadGraph = useLoadGraph()
  const registerEvents = useRegisterEvents()
  const setSettings = useSetSettings()
  const sigma = useSigma()

  const graph = useMemo(() => {
    const next = new UndirectedGraph()
    for (const node of nodes) {
      next.addNode(node.id, {
        x: node.x,
        y: node.y,
        size: Math.max(2.6, Math.min(11, node.size * 0.38)),
        label: node.label,
        color: nodeColours[node.type],
        nodeKind: node.type,
        community: node.community,
        alwaysLabel: node.always_label,
        forceLabel: node.always_label,
      })
    }
    for (const edge of edges) {
      if (!next.hasNode(edge.source) || !next.hasNode(edge.target)) continue
      // The snapshot is undirected and 09 deduplicates by unordered pair, so a
      // second edge here means a data regression. Skip rather than throw —
      // addEdgeWithKey raising takes the whole Constellation down.
      if (next.hasEdge(edge.source, edge.target)) continue
      next.addEdgeWithKey(edge.id, edge.source, edge.target, {
        size: edge.style.width,
        color:
          edge.support_type === 'model_similarity'
            ? 'rgba(56,189,248,.34)'
            : 'rgba(167,139,250,.26)',
        type: 'line',
      })
    }
    return next
  }, [edges, nodes])

  useEffect(() => {
    loadGraph(graph, true)
    sigma.getCamera().animatedReset({ duration: 420 })
  }, [graph, loadGraph, sigma])

  useEffect(() => {
    setSettings({
      nodeReducer: (node, attributes) => {
        const reduced = { ...attributes }
        if (path && !path.nodes.has(node)) {
          reduced.color = 'rgba(100,116,139,.12)'
          reduced.label = ''
          reduced.zIndex = 0
        } else if (node === selectedNodeId) {
          reduced.highlighted = true
          reduced.size = Number(attributes.size) * 1.35
          reduced.zIndex = 4
        } else if (path?.nodes.has(node)) {
          reduced.zIndex = 3
          reduced.size = Number(attributes.size) * 1.14
        }
        return reduced
      },
      edgeReducer: (edge, attributes) => {
        const reduced = { ...attributes }
        if (path && !path.edges.has(edge)) {
          reduced.hidden = true
        } else if (edge === selectedEdgeId || path?.edges.has(edge)) {
          reduced.color = '#FFC53D'
          reduced.size = 2.2
          reduced.zIndex = 3
        }
        return reduced
      },
    })
    sigma.refresh()
  }, [path, selectedEdgeId, selectedNodeId, setSettings, sigma])

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => onNode(node),
      clickEdge: ({ edge }) => onEdge(edge),
      clickStage: () => onClear(),
    })
  }, [onClear, onEdge, onNode, registerEvents])

  useEffect(() => {
    if (!focusNodeId || !graph.hasNode(focusNodeId)) return
    const display = sigma.getNodeDisplayData(focusNodeId)
    if (!display) return
    void sigma.getCamera().animate(
      { x: display.x, y: display.y, ratio: 0.23 },
      { duration: 480 },
    )
  }, [focusNodeId, graph, sigma])

  return null
}

export default function GraphCanvas(props: GraphStageProps) {
  return (
    <SigmaContainer
      className="h-full w-full"
      graph={UndirectedGraph}
      settings={{
        allowInvalidContainer: true,
        renderEdgeLabels: false,
        labelRenderedSizeThreshold: 9,
        labelFont: 'var(--f-sans)',
        labelColor: { color: '#E2E8F0' },
        defaultNodeColor: '#38BDF8',
        defaultEdgeColor: 'rgba(56,189,248,.22)',
        zIndex: true,
        hideEdgesOnMove: true,
        hideLabelsOnMove: true,
      }}
    >
      <GraphStage {...props} />
    </SigmaContainer>
  )
}
