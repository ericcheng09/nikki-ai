import { useId, useRef } from 'react'
import { OTHER_OPTION_VALUE } from '../lib/languages.js'

// 「語言」 select of the diary editor, plus the 「語言名稱」 input and its
// 「加入」 button shown while 「其他」 is chosen. Fully controlled: the
// editor owns the values and builds `options` (see languageOptions in
// languages.js). `onAdd()` resolves with true once the typed language was
// selected (the input then closes) and false otherwise; `adding` disables
// the button while the editor is busy.
export default function LanguageField({
  options,
  value,
  otherValue,
  onChange,
  onOtherChange,
  onAdd,
  adding = false,
}) {
  const selectId = useId()
  const otherInputId = useId()
  const selectRef = useRef(null)
  const otherInputRef = useRef(null)

  async function add() {
    const added = await onAdd()
    // The focused input disappears with 「其他」; move focus to the select,
    // which now shows the chosen language, instead of losing it to <body>.
    if (added) {
      selectRef.current?.focus()
    } else {
      // The input stays open with the text to fix. A click on 加入 would
      // otherwise leave focus on <body> (the button is disabled while
      // adding), so bring it back to the input.
      otherInputRef.current?.focus()
    }
  }

  function handleOtherKeyDown(event) {
    if (event.key !== 'Enter') return
    // Enter in a text input would submit the diary form; here it means 加入.
    // Enter that confirms an IME candidate (e.g. 注音, kana) must not
    // trigger anything. Most browsers flag it with isComposing; Safari
    // fires compositionend first, so its confirming Enter only shows up
    // as keyCode 229.
    event.preventDefault()
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    add()
  }

  return (
    <>
      <div className="field">
        <label htmlFor={selectId}>語言</label>
        <select
          id={selectId}
          ref={selectRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={`${option.kind}:${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {value === OTHER_OPTION_VALUE && (
        <div className="field field-full">
          <label htmlFor={otherInputId}>語言名稱</label>
          <div className="input-row">
            <input
              id={otherInputId}
              ref={otherInputRef}
              type="text"
              value={otherValue}
              placeholder="例如：韓文"
              onChange={(event) => onOtherChange(event.target.value)}
              onKeyDown={handleOtherKeyDown}
            />
            <button
              type="button"
              className="button button-secondary"
              onClick={add}
              disabled={adding}
            >
              加入
            </button>
          </div>
        </div>
      )}
    </>
  )
}
