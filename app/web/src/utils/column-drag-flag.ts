import { ref } from 'vue'

/**
 * Marks whether an "index column item" (rather than an index row) is being dragged.
 * The index column editor sets this to true when a drag starts and false when it ends;
 * the index table uses it to ignore row-level drag highlight / drop, so dragging a column
 * over other rows does not draw a full-row target line.
 */
export const isColumnDragging = ref(false)
