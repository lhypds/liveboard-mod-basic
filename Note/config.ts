export const config = {
  i: "Note",
  title: { en: "Note", ja: "ノート", zh: "笔记" },
  refreshAgeMinutes: 0,
  info: [],
  x: 0,
  y: 0,
  w: 19,
  h: 16,
  minW: 8,
  minH: 6,
  comp: {
    content: "",
    // Standing description of the scenario, sent with every Generate so the model
    // knows what this note is before it reads the instruction the user typed.
    // Its presence is also what puts the Generate button in the card's header.
    prompt: "A free-form personal note. Keep its language, wording and layout unless the instruction says otherwise.",
  },
};
