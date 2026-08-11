import { useState, type DragEvent } from 'react'
import type { TabState } from '../hooks/useWorkspace'

type TabBarProps = {
  tabs: TabState[]
  activeTabId: string | null
  secondaryTabId: string | null
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
}

export function TabBar({
  tabs,
  activeTabId,
  secondaryTabId,
  onActivate,
  onClose,
  onReorder,
}: TabBarProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  if (tabs.length === 0) {
    return null
  }

  const onDragStart = (event: DragEvent<HTMLButtonElement>, index: number) => {
    setDragIndex(index)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }

  const onDragOver = (event: DragEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (overIndex !== index) {
      setOverIndex(index)
    }
  }

  const onDrop = (event: DragEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault()
    const from = dragIndex ?? Number(event.dataTransfer.getData('text/plain'))
    if (Number.isFinite(from)) {
      onReorder(from, index)
    }
    setDragIndex(null)
    setOverIndex(null)
  }

  const onDragEnd = () => {
    setDragIndex(null)
    setOverIndex(null)
  }

  return (
    <div className="tab-bar" role="tablist" aria-label="Open documents">
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId
        const isSecondary = tab.id === secondaryTabId
        const className = [
          'tab',
          isActive ? 'active' : '',
          isSecondary ? 'secondary' : '',
          dragIndex === index ? 'dragging' : '',
          overIndex === index && dragIndex !== index ? 'drag-over' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div
            key={tab.id}
            className={['tab-item', isActive ? 'active' : '', isSecondary ? 'secondary' : '']
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className={className}
              title={tab.document.path}
              draggable
              onDragStart={(event) => onDragStart(event, index)}
              onDragOver={(event) => onDragOver(event, index)}
              onDrop={(event) => onDrop(event, index)}
              onDragEnd={onDragEnd}
              onClick={() => onActivate(tab.id)}
            >
              <span className="tab-label">
                {tab.document.dirty ? `${tab.document.fileName} *` : tab.document.fileName}
              </span>
            </button>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${tab.document.fileName}`}
              title={`Close ${tab.document.fileName}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose(tab.id)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
