import { Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';

const nodes = addListNodes(
  basicSchema.spec.nodes,
  'paragraph block*',
  'block'
);

const marks = basicSchema.spec.marks.addToEnd('strike', {
  parseDOM: [
    { tag: 's' },
    { tag: 'del' },
    { style: 'text-decoration=line-through' },
  ],
  toDOM() {
    return ['s', 0];
  },
});

export const schema = new Schema({ nodes, marks });
