import { categoriesApi } from '@/lib/api'
import type { Category, CategoryUpdate, NewCategory } from '@/types'
import { createResourceHooks } from './createResourceHooks'

const categoryHooks = createResourceHooks<Category, NewCategory, CategoryUpdate>(
  'categories',
  categoriesApi,
)

export const useCategories = categoryHooks.useList
export const useCreateCategory = categoryHooks.useCreate
export const useUpdateCategory = categoryHooks.useUpdate
export const useDeleteCategory = categoryHooks.useRemove
