import { describe, expect, it } from 'vitest'
import {
  PAGE_SIZE,
  clampPage,
  getPageWindow,
  pageBounds,
  pageCount,
  pageSlice,
} from './pagination'

describe('pageCount', () => {
  it('is 1 for an empty list', () => {
    expect(pageCount(0)).toBe(1)
  })
  it('does not add a page for an exact multiple', () => {
    expect(pageCount(10)).toBe(1)
    expect(pageCount(20)).toBe(2)
  })
  it('rounds a partial page up', () => {
    expect(pageCount(11)).toBe(2)
    expect(pageCount(1)).toBe(1)
  })
  it('honours a custom page size', () => {
    expect(pageCount(25, 5)).toBe(5)
  })
})

describe('clampPage', () => {
  it('clamps below range to 1', () => {
    expect(clampPage(0, 5)).toBe(1)
    expect(clampPage(-3, 5)).toBe(1)
  })
  it('clamps above range to the last page', () => {
    expect(clampPage(9, 5)).toBe(5)
  })
  it('keeps an in-range page', () => {
    expect(clampPage(3, 5)).toBe(3)
  })
  it('never returns below 1 even when totalPages is 0', () => {
    expect(clampPage(2, 0)).toBe(1)
  })
  it('falls back to 1 for a non-finite page', () => {
    expect(clampPage(Number.NaN, 5)).toBe(1)
  })
})

describe('pageSlice', () => {
  const items = Array.from({ length: 23 }, (_, i) => i + 1) // 1..23

  it('returns the first PAGE_SIZE items on page 1', () => {
    expect(pageSlice(items, 1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
  it('returns the middle window on page 2', () => {
    expect(pageSlice(items, 2)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  })
  it('returns the remainder on the last page', () => {
    expect(pageSlice(items, 3)).toEqual([21, 22, 23])
  })
  it('clamps an over-range page to the last page rather than returning []', () => {
    expect(pageSlice(items, 99)).toEqual([21, 22, 23])
  })
  it('returns [] for an empty list', () => {
    expect(pageSlice([], 1)).toEqual([])
  })
})

describe('pageBounds', () => {
  it('is 0 of 0 for an empty list', () => {
    expect(pageBounds(1, PAGE_SIZE, 0)).toEqual({ startIndex: 0, endIndex: 0 })
  })
  it('describes the first page', () => {
    expect(pageBounds(1, PAGE_SIZE, 23)).toEqual({ startIndex: 1, endIndex: 10 })
  })
  it('describes a partial last page', () => {
    expect(pageBounds(3, PAGE_SIZE, 23)).toEqual({ startIndex: 21, endIndex: 23 })
  })
})

describe('getPageWindow', () => {
  it('is a single page for a short list', () => {
    expect(getPageWindow(1, 1)).toEqual([1])
  })
  it('lists every page with no ellipsis when they all fit', () => {
    expect(getPageWindow(2, 3)).toEqual([1, 2, 3])
    expect(getPageWindow(1, 5)).toEqual([1, 2, 3, 4, 5])
  })
  it('brackets the current page with ellipses in the middle', () => {
    expect(getPageWindow(5, 12)).toEqual([1, '…', 4, 5, 6, '…', 12])
  })
  it('shows a lone hidden page as its number rather than an ellipsis', () => {
    expect(getPageWindow(1, 4)).toEqual([1, 2, 3, 4])
    expect(getPageWindow(1, 12)).toEqual([1, 2, '…', 12])
  })
  it('has no leading ellipsis near the start', () => {
    expect(getPageWindow(2, 12)).toEqual([1, 2, 3, '…', 12])
  })
  it('has no trailing ellipsis near the end', () => {
    expect(getPageWindow(11, 12)).toEqual([1, '…', 10, 11, 12])
  })
})
