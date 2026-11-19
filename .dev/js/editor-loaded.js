// Whether the page has loaded the editor's code, which only the notes need:
// its style sheet is in the head once it has.
//   node .dev/cdp.mjs @.dev/js/editor-loaded.js widget
document.querySelectorAll('link[href*="/editor-"]').length > 0
