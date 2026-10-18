import { fireEvent, render, screen } from '@testing-library/react'
import LanguageField from './LanguageField.jsx'
import { OTHER_OPTION_VALUE, languageOptions } from '../lib/languages.js'

function renderField(props = {}) {
  const onChange = vi.fn()
  const onOtherChange = vi.fn()
  render(
    <LanguageField
      options={languageOptions([], 'auto')}
      value="auto"
      otherValue=""
      onChange={onChange}
      onOtherChange={onOtherChange}
      {...props}
    />,
  )
  return { onChange, onOtherChange }
}

describe('LanguageField', () => {
  it('shows the options and reports a new choice', () => {
    const { onChange } = renderField()
    const select = screen.getByRole('combobox', { name: '語言' })
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      '自動判斷',
      '日文',
      '英文',
      '其他',
    ])
    expect(screen.queryByLabelText('語言名稱')).not.toBeInTheDocument()
    fireEvent.change(select, { target: { value: '日文' } })
    expect(onChange).toHaveBeenCalledWith('日文')
  })

  it('shows the 語言名稱 input only for 其他 and reports typing', () => {
    const { onOtherChange } = renderField({ value: OTHER_OPTION_VALUE, otherValue: '韓' })
    const input = screen.getByLabelText('語言名稱')
    expect(input).toHaveValue('韓')
    expect(input).toHaveAttribute('placeholder', '例如：韓文')
    fireEvent.change(input, { target: { value: '韓文' } })
    expect(onOtherChange).toHaveBeenCalledWith('韓文')
  })
})
