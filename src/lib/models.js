// Pure rules for which Gemini models the settings page offers
// (decisions.md Phase 2 「Gemini 模型」). Input is the full list from
// listModels (gemini.js): every models/gemini* model that supports
// generateContent, as [{ name, displayName }] in API order.

// Stable main text models only: gemini-<version>-pro / -flash /
// -flash-lite, optionally pinned with a 3-digit revision (e.g. -001).
// Anything with an extra suffix (preview, exp, latest, image, tts, audio,
// live, 8b, ...) does not match. Change this one pattern to change the
// list.
const MAIN_TEXT_MODEL = /^models\/gemini-\d+(\.\d+)?-(pro|flash|flash-lite)(-\d{3})?$/

export function isMainTextModel(name) {
  return typeof name === 'string' && MAIN_TEXT_MODEL.test(name)
}

// The models to list: the main text models, or, when none of them is
// available to this key, every model in the full list.
export function shownModels(models) {
  if (!Array.isArray(models)) return []
  const main = models.filter((model) => isMainTextModel(model?.name))
  return main.length > 0 ? main : models
}

// Options for the model select plus whether the saved model is still
// usable. A saved model left out by the filter but still in the full list
// (e.g. a preview picked before the filter existed) keeps working, so it
// is appended as an extra option instead of being reported as gone;
// only a model missing from the full list counts as unusable.
export function modelChoices(models, savedModel) {
  const options = shownModels(models)
  if (!savedModel) return { options, savedUsable: false }
  if (options.some((model) => model.name === savedModel)) {
    return { options, savedUsable: true }
  }
  const saved = Array.isArray(models) ? models.find((model) => model?.name === savedModel) : undefined
  if (!saved) return { options, savedUsable: false }
  return { options: [...options, saved], savedUsable: true }
}
