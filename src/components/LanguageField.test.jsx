import { act, fireEvent, render, screen } from '@testing-library/react'
import LanguageField from './LanguageField.jsx'
import { OTHER_OPTION_VALUE, languageOptions } from '../lib/languages.js'

function renderField(props = {}) {
  const onChange = vi.fn()
  const onOtherChange = vi.fn()
  const onAdd = vi.fn().mockResolvedValue(true)
  render(
    <LanguageField
      options={languageOptions([], 'auto')}
      value="auto"
      otherValue=""
      onChange={onChange}
      onOtherChange={onOtherChange}
      onAdd={onAdd}
      {...props}
    />,
  )
  return { onChange, onOtherChange, onAdd: props.onAdd ?? onAdd }
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

  it('shows no 加入 button unless 其他 is chosen', () => {
    renderField()
    expect(screen.queryByRole('button', { name: '加入' })).not.toBeInTheDocument()
  })

  it('calls onAdd from the 加入 button and then focuses the select', async () => {
    const { onAdd } = renderField({ value: OTHER_OPTION_VALUE, otherValue: '韓文' })
    const button = screen.getByRole('button', { name: '加入' })
    expect(button).toHaveAttribute('type', 'button')
    await act(async () => fireEvent.click(button))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('combobox', { name: '語言' })).toHaveFocus()
  })

  it('treats Enter in the input as 加入 and keeps it from submitting the form', async () => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    const onAdd = vi.fn().mockResolvedValue(true)
    render(
      <form onSubmit={onSubmit}>
        <LanguageField
          options={languageOptions([], 'auto')}
          value={OTHER_OPTION_VALUE}
          otherValue="韓文"
          onChange={vi.fn()}
          onOtherChange={vi.fn()}
          onAdd={onAdd}
        />
      </form>,
    )
    const input = screen.getByLabelText('語言名稱')
    let notPrevented
    await act(async () => {
      notPrevented = fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(notPrevented).toBe(false)
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('ignores Enter that confirms an IME composition and other keys', async () => {
    const { onAdd } = renderField({ value: OTHER_OPTION_VALUE, otherValue: 'かん' })
    const input = screen.getByLabelText('語言名稱')
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
      fireEvent.keyDown(input, { key: 'a' })
    })
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('ignores the Enter that Safari sends after compositionend (keyCode 229)', async () => {
    const { onAdd } = renderField({ value: OTHER_OPTION_VALUE, otherValue: '韓' })
    const input = screen.getByLabelText('語言名稱')
    let notPrevented
    await act(async () => {
      notPrevented = fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: false })
    })
    expect(onAdd).not.toHaveBeenCalled()
    // Still never submits the form.
    expect(notPrevented).toBe(false)
  })

  it('moves focus back to the input when a click on 加入 fails', async () => {
    const onAdd = vi.fn().mockResolvedValue(false)
    renderField({ value: OTHER_OPTION_VALUE, otherValue: '韓文', onAdd })
    const button = screen.getByRole('button', { name: '加入' })
    button.focus()
    await act(async () => fireEvent.click(button))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('語言名稱')).toHaveFocus()
  })

  it('keeps focus in the input when onAdd reports failure', async () => {
    const onAdd = vi.fn().mockResolvedValue(false)
    renderField({ value: OTHER_OPTION_VALUE, otherValue: '', onAdd })
    const input = screen.getByLabelText('語言名稱')
    input.focus()
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(input).toHaveFocus()
  })

  it('disables 加入 while adding', () => {
    renderField({ value: OTHER_OPTION_VALUE, adding: true })
    expect(screen.getByRole('button', { name: '加入' })).toBeDisabled()
  })
})
