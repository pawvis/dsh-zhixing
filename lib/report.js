/** 知行 · 日报解析与待办生成 */
import { addDays, dateKey } from './store.js'

export const PLAN_HEADING = '明天准备干什么'
export const DONE_HEADING = '今天干了什么'
export const RISK_HEADING = '问题与风险'

/** 按二级标题切分 Markdown。 */
export function splitSections(markdown) {
  const sections = new Map()
  let current = ''
  const buffer = []
  const flush = () => {
    if (current || buffer.length) sections.set(current, buffer.join('\n').trim())
    buffer.length = 0
  }
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) { flush(); current = heading[1].trim(); continue }
    buffer.push(line)
  }
  flush()
  return sections
}

export function bulletItems(block) {
  const items = []
  for (const line of String(block ?? '').split(/\r?\n/)) {
    const match = /^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$/.exec(line)
    if (match) items.push(match[1].trim())
  }
  return items
}

/** 去掉内容末尾的来源标记，生成待办时用。 */
export function stripSource(text) {
  return String(text ?? '').replace(/（来源：[^）]*）\s*$/, '').replace(/\(来源[:：][^)]*\)\s*$/, '').trim()
}

export function parseReport(markdown) {
  const sections = splitSections(markdown)
  return {
    done: bulletItems(sections.get(DONE_HEADING)),
    plan: bulletItems(sections.get(PLAN_HEADING)),
    risks: bulletItems(sections.get(RISK_HEADING)),
  }
}

let counter = 0
export function todoId(date) {
  counter = (counter + 1) % 10000
  return `t-${date.replace(/-/g, '')}-${Date.now().toString(36).slice(-4)}${String(counter).padStart(2, '0')}`
}

/**
 * 保存日报后：把「明天准备干什么」写成次日待办。
 * 同一份日报重复保存时，先移除它上次生成的待办，避免重复。
 */
export async function applyPlanToTodos(store, { date, markdown }) {
  const { plan } = parseReport(markdown)
  const targetDate = addDays(date, 1)
  const source = `日报:${date}.md`
  const created = []
  await store.update('todos', { version: 1, items: [] }, (todos) => {
    todos.items = Array.isArray(todos.items) ? todos.items : []
    // 同一份日报重复保存：保留已完成/已顺延的同名待办，避免丢状态。
    const existing = new Map()
    for (const todo of todos.items) {
      if (todo.date === targetDate && todo.source === source) existing.set(todo.content, todo)
    }
    todos.items = todos.items.filter((todo) => !(todo.date === targetDate && todo.source === source))
    for (const text of plan) {
      const previous = existing.get(text)
      const item = previous
        ? { ...previous, updatedAt: new Date().toISOString() }
        : {
            id: todoId(targetDate),
            content: text,
            date: targetDate,
            source,
            status: '未做',
            goalId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }
      todos.items.push(item)
      created.push(item)
    }
    return todos
  })
  await store.refreshOverview()
  return { targetDate, created }
}

export async function applyManualTodos(store, { date, texts, startDate, dueDate, source = '人工输入', aiModel }) {
  const created = []
  const dueRaw = String(dueDate || date)
  const due = dueRaw.slice(0, 10)
  const start = String(startDate || due).slice(0, 10)
  await store.update('todos', { version: 1, items: [] }, (todos) => {
    todos.items = Array.isArray(todos.items) ? todos.items : []
    for (const text of texts) {
      const item = {
        id: todoId(due),
        content: text,
        date: due,
        startDate: start,
        dueDate: dueRaw,
        source,
        ...(aiModel ? { aiModel: String(aiModel) } : {}),
        status: '未做',
        goalId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      todos.items.push(item)
      created.push(item)
    }
    return todos
  })
  await store.refreshOverview()
  return created
}

export async function setTodoStatus(store, { id, status }) {
  let updated = null
  await store.update('todos', { version: 1, items: [] }, (todos) => {
    const item = (todos.items ?? []).find((todo) => todo.id === id)
    if (!item) { const e = new Error('待办不存在'); e.status = 404; throw e }
    item.status = status
    // 完成时记 doneAt（证据统计用）；重新打开时清掉，避免重复计数。
    if (status === '完成') item.doneAt = new Date().toISOString()
    else if (item.doneAt) delete item.doneAt
    item.updatedAt = new Date().toISOString()
    updated = item
    return todos
  })
  await store.refreshOverview()
  return updated
}

export async function postponeTodos(store, { ids, toDate = dateKey() }) {
  const moved = []
  await store.update('todos', { version: 1, items: [] }, (todos) => {
    for (const todo of todos.items ?? []) {
      if (!ids.includes(todo.id)) continue
      // 记下顺延前的日期；老数据没有 postponedFrom 时按空数组补齐。
      const from = String(todo.date ?? '').slice(0, 10)
      todo.date = toDate
      todo.status = '顺延'
      todo.postponedFrom = Array.isArray(todo.postponedFrom) ? todo.postponedFrom : []
      if (from) todo.postponedFrom.push(from)
      todo.updatedAt = new Date().toISOString()
      moved.push(todo)
    }
    return todos
  })
  await store.refreshOverview()
  return moved
}
