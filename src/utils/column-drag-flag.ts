import { ref } from 'vue'

/**
 * 标记当前是否正在拖拽「索引列项」（而非索引行）。
 * 索引列编辑器在拖拽开始时置 true、结束时置 false；
 * 索引表据此忽略行级拖拽高亮 / 投放，避免把列拖到其它行上时出现整行目标线。
 */
export const isColumnDragging = ref(false)
