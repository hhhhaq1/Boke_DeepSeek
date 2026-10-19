/**
 * 说说读取与排序的公共逻辑。
 * 与 utils/posts.ts 保持同样的约定：新增一条说说只需要丢一个 .md 文件进目录。
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import { categoryColor, categoryOrder } from '../config';

export type Note = CollectionEntry<'notes'>;

/**
 * 取全部已发布说说。
 * 排序规则：置顶优先，其余按发布时间倒序。
 */
export async function getSortedNotes(): Promise<Note[]> {
  const notes = await getCollection('notes', ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true;
  });

  return notes.sort((a, b) => {
    if (a.data.pinned !== b.data.pinned) return a.data.pinned ? -1 : 1;
    return b.data.pubDate.valueOf() - a.data.pubDate.valueOf();
  });
}

/**
 * 统计说说用到的分类及各自条数。
 * 顺序按 config 里 NOTE_CATEGORIES 的登记顺序（杂项在最后），
 * 没登记过的分类排在其后。只返回真正有内容的分类，空分类不占位。
 */
export function collectNoteCategories(
  notes: Note[]
): { name: string; count: number; color: string }[] {
  const map = new Map<string, number>();
  for (const note of notes) {
    const name = note.data.category;
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count, color: categoryColor(name) }))
    .sort(
      (a, b) =>
        categoryOrder(a.name) - categoryOrder(b.name) ||
        a.name.localeCompare(b.name)
    );
}

/** 按「年-月」分组，用于时间轴上的月份分隔 */
export function groupNotesByMonth(
  notes: Note[]
): { key: string; label: string; notes: Note[] }[] {
  const map = new Map<string, Note[]>();
  for (const note of notes) {
    const d = note.data.pubDate;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const list = map.get(key);
    if (list) list.push(note);
    else map.set(key, [note]);
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key,
      label: `${key.slice(0, 4)} 年 ${Number(key.slice(5))} 月`,
      notes: list,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

/** 图片数量 → 网格布局标记，CSS 按这个值决定几列几行 */
export function gridKind(count: number): string {
  if (count <= 1) return 'single';
  if (count === 2) return 'two';
  if (count === 4) return 'four';
  return 'many'; // 3 张、5–9 张统一走三列
}
