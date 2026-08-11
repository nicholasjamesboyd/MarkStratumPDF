import { useEffect, useRef, useState, type ChangeEvent, type SyntheticEvent } from 'react'
import type { FormFieldInfo, FormValueUpdate } from '../../shared/ipc'

type FormFieldOverlaysProps = {
  fields: FormFieldInfo[]
  pageIndex: number
  pageHeightPts: number
  scale: number
  onValuesChange: (updates: FormValueUpdate[]) => void
}

const TEXT_DEBOUNCE_MS = 150

export function FormFieldOverlays({
  fields,
  pageIndex,
  pageHeightPts,
  scale,
  onValuesChange,
}: FormFieldOverlaysProps) {
  const pageFields = fields.filter(
    (field) => field.pageIndex === pageIndex && field.bounds,
  )

  if (pageFields.length === 0) {
    return null
  }

  return (
    <div className="form-field-layer" aria-hidden={false}>
      {pageFields.map((field, index) => (
        <FormFieldControl
          key={`${field.name}-${pageIndex}-${index}`}
          field={field}
          pageHeightPts={pageHeightPts}
          scale={scale}
          onValuesChange={onValuesChange}
        />
      ))}
    </div>
  )
}

function FormFieldControl({
  field,
  pageHeightPts,
  scale,
  onValuesChange,
}: {
  field: FormFieldInfo
  pageHeightPts: number
  scale: number
  onValuesChange: (updates: FormValueUpdate[]) => void
}) {
  const bounds = field.bounds!
  const left = bounds.left * scale
  const top = (pageHeightPts - bounds.top) * scale
  const width = Math.max(4, (bounds.right - bounds.left) * scale)
  const height = Math.max(4, (bounds.top - bounds.bottom) * scale)
  const style = {
    left,
    top,
    width,
    height,
  }

  const [textValue, setTextValue] = useState(field.value)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setTextValue(field.value)
  }, [field.value, field.name])

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  const commitText = (value: string) => {
    onValuesChange([{ name: field.name, value }])
  }

  const onTextChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value
    setTextValue(value)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      commitText(value)
    }, TEXT_DEBOUNCE_MS)
  }

  const stopPointer = (event: SyntheticEvent) => {
    event.stopPropagation()
  }

  if (field.type === 'textField') {
    const common = {
      className: 'form-field-control form-field-text',
      style,
      value: textValue,
      readOnly: field.readOnly,
      disabled: field.readOnly,
      title: field.alternateName || field.name,
      'aria-label': field.alternateName || field.name,
      onChange: onTextChange,
      onBlur: () => commitText(textValue),
      onPointerDown: stopPointer,
      onMouseDown: stopPointer,
    }
    if (field.multiline) {
      return <textarea {...common} />
    }
    return <input type="text" {...common} />
  }

  if (field.type === 'checkbox') {
    return (
      <label
        className="form-field-control form-field-checkbox"
        style={style}
        title={field.alternateName || field.name}
        onPointerDown={stopPointer}
        onMouseDown={stopPointer}
      >
        <input
          type="checkbox"
          checked={field.isChecked}
          disabled={field.readOnly}
          aria-label={field.alternateName || field.name}
          onChange={(event) => {
            onValuesChange([{ name: field.name, value: event.target.checked ? 'true' : 'false' }])
          }}
        />
      </label>
    )
  }

  if (field.type === 'radioButton') {
    const optionValue = field.exportValue || field.value || 'Yes'
    return (
      <label
        className="form-field-control form-field-radio"
        style={style}
        title={field.alternateName || field.name}
        onPointerDown={stopPointer}
        onMouseDown={stopPointer}
      >
        <input
          type="radio"
          name={`pdf-radio-${field.name}`}
          value={optionValue}
          checked={field.isChecked}
          disabled={field.readOnly}
          aria-label={field.alternateName || field.name}
          onChange={() => {
            onValuesChange([{ name: field.name, value: optionValue }])
          }}
        />
      </label>
    )
  }

  if (field.type === 'comboBox' || field.type === 'listBox') {
    const options = field.options ?? []
    return (
      <select
        className="form-field-control form-field-select"
        style={style}
        value={field.value}
        disabled={field.readOnly}
        title={field.alternateName || field.name}
        aria-label={field.alternateName || field.name}
        onChange={(event) => {
          onValuesChange([{ name: field.name, value: event.target.value }])
        }}
        onPointerDown={stopPointer}
        onMouseDown={stopPointer}
      >
        {!options.some((option) => option.label === field.value) ? (
          <option value={field.value}>{field.value || ''}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.label} value={option.label}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }

  return null
}
