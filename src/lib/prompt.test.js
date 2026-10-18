import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildPrompt, PROMPT_TEMPLATE } from './prompt.js'

// The template must match spec 5.5 character for character; reading the
// spec here makes any drift between the two fail the tests. Vitest runs
// from the project root (import.meta.url is not a file URL under jsdom).
function specTemplate() {
  const spec = readFileSync(resolve(process.cwd(), 'docs/spec.md'), 'utf8')
  const section = spec.indexOf('### 5.5')
  const start = spec.indexOf('```text\n', section) + '```text\n'.length
  const end = spec.indexOf('\n```', start)
  return spec.slice(start, end)
}

const AUTO_INSTRUCTION = '請先判斷日記使用的語言。'

function expected(instruction, diary) {
  return specTemplate()
    .split('{{LANGUAGE_INSTRUCTION}}')
    .join(instruction)
    .split('{{DIARY}}')
    .join(diary)
}

describe('PROMPT_TEMPLATE', () => {
  it('is exactly the template from spec 5.5', () => {
    expect(specTemplate()).toContain('{{DIARY}}')
    expect(PROMPT_TEMPLATE).toBe(specTemplate())
  })
})

describe('buildPrompt', () => {
  it('asks the model to detect the language for auto', () => {
    expect(buildPrompt({ content: 'Hello', language: 'auto' })).toBe(
      expected(AUTO_INSTRUCTION, 'Hello'),
    )
  })

  it.each([[undefined], [null], [''], ['  '], [42], ['自動判斷']])(
    'treats a missing or invalid language (%j) as auto',
    (language) => {
      expect(buildPrompt({ content: 'Hi', language })).toBe(expected(AUTO_INSTRUCTION, 'Hi'))
    },
  )

  it.each(['日文', '英文', '韓文', 'Deutsch'])('names the language %s', (language) => {
    expect(buildPrompt({ content: 'x', language })).toBe(
      expected(`這篇日記使用的語言是${language}。`, 'x'),
    )
  })

  it('inserts the content verbatim, without trimming', () => {
    const content = '  第一行\n\n  second line\t\n'
    const prompt = buildPrompt({ content, language: '日文' })
    expect(prompt).toContain(`"""\n${content}\n"""`)
  })

  it('inserts special replacement patterns and placeholders literally', () => {
    const content = "$& $1 $$ $' $` {{DIARY}} {{LANGUAGE_INSTRUCTION}}"
    const prompt = buildPrompt({ content, language: 'auto' })
    expect(prompt).toBe(expected(AUTO_INSTRUCTION, content))
    expect(prompt.endsWith(`"""\n${content}\n"""`)).toBe(true)
    // The instruction is only inserted once, in the template's position.
    expect(prompt.split(AUTO_INSTRUCTION)).toHaveLength(2)
  })

  it('does not expand placeholders inside a custom language name', () => {
    const language = '{{DIARY}}$&'
    const prompt = buildPrompt({ content: 'body', language })
    expect(prompt).toContain(`這篇日記使用的語言是${language}。`)
    expect(prompt.endsWith('"""\nbody\n"""')).toBe(true)
  })

  it('uses the trimmed language name', () => {
    expect(buildPrompt({ content: 'x', language: ' 韓文 ' })).toContain(
      '這篇日記使用的語言是韓文。',
    )
  })

  it('treats missing content as empty', () => {
    expect(buildPrompt({ language: 'auto' })).toBe(expected(AUTO_INSTRUCTION, ''))
    expect(buildPrompt({ content: 12, language: 'auto' })).toBe(expected(AUTO_INSTRUCTION, ''))
  })
})
