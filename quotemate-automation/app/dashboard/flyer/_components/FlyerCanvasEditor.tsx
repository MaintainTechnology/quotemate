'use client'

// Flyer Designer — interactive Konva canvas.
//
// Renders the flyer document as draggable / resizable Konva nodes. All server
// IO (save, upload, QR, export) lives in the parent FlyerDesignerTab; this
// component is purely the canvas + selection + geometry editing. It is loaded
// via next/dynamic({ ssr: false }) because Konva needs the browser.

import { useEffect, useMemo, useRef, useState } from 'react'
import Konva from 'konva'
import { Stage, Layer, Rect, Text, Image as KonvaImage, Transformer } from 'react-konva'
import type { FlyerDocument, FlyerElement } from '@/lib/flyer/schema'

function useLoadedImage(src: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    let live = true
    if (!src) {
      // Clear in a microtask so we never setState synchronously in an effect.
      Promise.resolve().then(() => {
        if (live) setImg(null)
      })
      return () => {
        live = false
      }
    }
    const image = new window.Image()
    image.crossOrigin = 'anonymous'
    const onLoad = () => {
      if (live) setImg(image)
    }
    image.addEventListener('load', onLoad)
    image.src = src
    return () => {
      live = false
      image.removeEventListener('load', onLoad)
    }
  }, [src])
  return img
}

function CanvasImage({
  el,
  draggable,
  onRef,
  onSelect,
  onChange,
}: {
  el: Extract<FlyerElement, { kind: 'image' }>
  draggable: boolean
  onRef: (node: Konva.Node | null) => void
  onSelect: () => void
  onChange: (patch: Partial<FlyerElement>) => void
}) {
  const img = useLoadedImage(el.src)
  if (!img) {
    // Placeholder frame while empty / loading so the slot is visible/selectable.
    return (
      <Rect
        ref={onRef as never}
        x={el.x}
        y={el.y}
        width={el.width}
        height={el.height}
        rotation={el.rotation ?? 0}
        fill="#1B2536"
        stroke="#33415A"
        strokeWidth={1}
        dash={[6, 6]}
        draggable={draggable}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      />
    )
  }
  return (
    <KonvaImage
      ref={onRef as never}
      image={img}
      x={el.x}
      y={el.y}
      width={el.width}
      height={el.height}
      rotation={el.rotation ?? 0}
      draggable={draggable}
      onClick={onSelect}
      onTap={onSelect}
      onDragEnd={(e) => onChange({ x: e.target.x(), y: e.target.y() })}
      onTransformEnd={(e) => {
        const node = e.target
        const scaleX = node.scaleX()
        const scaleY = node.scaleY()
        node.scaleX(1)
        node.scaleY(1)
        onChange({
          x: node.x(),
          y: node.y(),
          width: Math.max(8, node.width() * scaleX),
          height: Math.max(8, node.height() * scaleY),
          rotation: node.rotation(),
        })
      }}
    />
  )
}

export type FlyerCanvasEditorProps = {
  document: FlyerDocument
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (elements: FlyerElement[]) => void
  onStageReady: (stage: Konva.Stage | null) => void
}

export default function FlyerCanvasEditor({
  document,
  selectedId,
  onSelect,
  onChange,
  onStageReady,
}: FlyerCanvasEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const trRef = useRef<Konva.Transformer | null>(null)
  const nodeRefs = useRef<Map<string, Konva.Node>>(new Map())
  const [containerWidth, setContainerWidth] = useState(600)

  // Fit the fixed-size flyer canvas to the available column width.
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const update = () => setContainerWidth(node.clientWidth || 600)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [])

  const scale = useMemo(
    () => Math.min(1, containerWidth / document.width),
    [containerWidth, document.width],
  )

  useEffect(() => {
    onStageReady(stageRef.current)
    return () => onStageReady(null)
  }, [onStageReady])

  // Keep the transformer attached to the selected node.
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const node = selectedId ? nodeRefs.current.get(selectedId) ?? null : null
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [selectedId, document.elements])

  function patchEl(id: string, patch: Partial<FlyerElement>) {
    onChange(
      document.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as FlyerElement) : e)),
    )
  }

  function registerNode(id: string, node: Konva.Node | null) {
    if (node) nodeRefs.current.set(id, node)
    else nodeRefs.current.delete(id)
  }

  return (
    <div ref={containerRef} className="w-full">
      <Stage
        ref={(node) => {
          stageRef.current = node
        }}
        width={document.width * scale}
        height={document.height * scale}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) onSelect(null)
        }}
        onTouchStart={(e) => {
          if (e.target === e.target.getStage()) onSelect(null)
        }}
        style={{ background: document.background, border: '1px solid #33415A' }}
      >
        <Layer>
          <Rect x={0} y={0} width={document.width} height={document.height} fill={document.background} listening={false} />
          {document.elements.map((el) => {
            const draggable = true
            if (el.kind === 'rect') {
              return (
                <Rect
                  key={el.id}
                  ref={(node) => registerNode(el.id, node)}
                  x={el.x}
                  y={el.y}
                  width={el.width}
                  height={el.height}
                  rotation={el.rotation ?? 0}
                  fill={el.fill}
                  cornerRadius={el.cornerRadius ?? 0}
                  draggable={draggable}
                  onClick={() => onSelect(el.id)}
                  onTap={() => onSelect(el.id)}
                  onDragEnd={(e) => patchEl(el.id, { x: e.target.x(), y: e.target.y() })}
                  onTransformEnd={(e) => {
                    const node = e.target
                    const sx = node.scaleX()
                    const sy = node.scaleY()
                    node.scaleX(1)
                    node.scaleY(1)
                    patchEl(el.id, {
                      x: node.x(),
                      y: node.y(),
                      width: Math.max(8, node.width() * sx),
                      height: Math.max(8, node.height() * sy),
                      rotation: node.rotation(),
                    })
                  }}
                />
              )
            }
            if (el.kind === 'text') {
              return (
                <Text
                  key={el.id}
                  ref={(node) => registerNode(el.id, node)}
                  x={el.x}
                  y={el.y}
                  width={el.width}
                  rotation={el.rotation ?? 0}
                  text={el.text}
                  fontFamily={el.fontFamily}
                  fontSize={el.fontSize}
                  fontStyle={el.fontStyle ?? 'normal'}
                  fill={el.fill}
                  align={el.align ?? 'left'}
                  draggable={draggable}
                  onClick={() => onSelect(el.id)}
                  onTap={() => onSelect(el.id)}
                  onDragEnd={(e) => patchEl(el.id, { x: e.target.x(), y: e.target.y() })}
                  onTransformEnd={(e) => {
                    const node = e.target as Konva.Text
                    const sx = node.scaleX()
                    node.scaleX(1)
                    node.scaleY(1)
                    patchEl(el.id, {
                      x: node.x(),
                      y: node.y(),
                      width: Math.max(20, node.width() * sx),
                      rotation: node.rotation(),
                    })
                  }}
                />
              )
            }
            return (
              <CanvasImage
                key={el.id}
                el={el}
                draggable={draggable}
                onRef={(node) => registerNode(el.id, node)}
                onSelect={() => onSelect(el.id)}
                onChange={(patch) => patchEl(el.id, patch)}
              />
            )
          })}
          <Transformer
            ref={(node) => {
              trRef.current = node
            }}
            rotateEnabled
            keepRatio={false}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 12 || newBox.height < 12 ? oldBox : newBox)}
          />
        </Layer>
      </Stage>
    </div>
  )
}
