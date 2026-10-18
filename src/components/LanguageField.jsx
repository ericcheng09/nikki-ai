import { useId } from 'react'
import { OTHER_OPTION_VALUE } from '../lib/languages.js'

// 「語言」 select of the diary editor, plus the 「語言名稱」 input shown
// while 「其他」 is chosen. Fully controlled: the editor owns the values
// and builds `options` (see languageOptions in languages.js).
export default function LanguageField({ options, value, otherValue, onChange, onOtherChange }) {
  const selectId = useId()
  const otherInputId = useId()

  return (
    <>
      <div className="field">
        <label htmlFor={selectId}>語言</label>
        <select id={selectId} value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={`${option.kind}:${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {value === OTHER_OPTION_VALUE && (
        <div className="field">
          <label htmlFor={otherInputId}>語言名稱</label>
          <input
            id={otherInputId}
            type="text"
            value={otherValue}
            placeholder="例如：韓文"
            onChange={(event) => onOtherChange(event.target.value)}
          />
        </div>
      )}
    </>
  )
}
