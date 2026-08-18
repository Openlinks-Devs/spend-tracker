import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { IconPlus, IconPencil, IconTrash } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  categoryLabel,
  collectDescendantIds,
  flattenCategoryTree,
} from '@/lib/categoryTree'
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '@/hooks/useCategories'
import { toErrorMessage } from '@/lib/api'
import type { Category } from '@/types'

interface CategoryFormState {
  name: string
  type: string
  emoji: string
  parentId: string
}

// 'out' and 'in' are the values the column actually stores; the labels are what
// the user reads.
const categoryTypeOptions = [
  { value: 'out', label: 'Expense' },
  { value: 'in', label: 'Income' },
]

const typeLabels: Record<string, string> = { out: 'Expense', in: 'Income' }

// Select cannot carry an empty string as a value, so "no parent" needs a
// sentinel that no category id can collide with.
const NO_PARENT_VALUE = 'none'

const emptyFormState: CategoryFormState = {
  name: '',
  type: 'out',
  emoji: '',
  parentId: NO_PARENT_VALUE,
}

export function CategoriesPage() {
  const categoriesQuery = useCategories()
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()
  const deleteCategory = useDeleteCategory()

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [formState, setFormState] = useState<CategoryFormState>(emptyFormState)
  const [formError, setFormError] = useState<string | null>(null)

  const categories = categoriesQuery.data ?? []
  const isEditing = editingCategory !== null
  const flatCategories = useMemo(() => flattenCategoryTree(categories), [categories])

  // A category cannot be nested under itself or under one of its own children,
  // so those are left out of the parent picker rather than rejected on save.
  const parentOptions = useMemo(() => {
    if (!editingCategory) return flatCategories
    const excluded = collectDescendantIds(categories, editingCategory.id)
    return flatCategories.filter((entry) => !excluded.has(entry.category.id))
  }, [flatCategories, categories, editingCategory])

  useEffect(() => {
    if (!isDialogOpen) return
    if (editingCategory) {
      setFormState({
        name: editingCategory.name,
        type: editingCategory.type,
        emoji: editingCategory.emoji ?? '',
        parentId: editingCategory.parent_id ?? NO_PARENT_VALUE,
      })
    } else {
      setFormState(emptyFormState)
    }
  }, [isDialogOpen, editingCategory])

  function openCreateDialog() {
    setEditingCategory(null)
    setFormError(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(category: Category) {
    setEditingCategory(category)
    setFormError(null)
    setIsDialogOpen(true)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const payload = {
      name: formState.name,
      type: formState.type,
      emoji: formState.emoji.trim() === '' ? null : formState.emoji.trim(),
      parent_id: formState.parentId === NO_PARENT_VALUE ? null : formState.parentId,
    }
    if (isEditing && editingCategory) {
      updateCategory.mutate(
        { id: editingCategory.id, payload },
        {
          onSuccess: () => setIsDialogOpen(false),
          onError: (error) => setFormError(toErrorMessage(error)),
        },
      )
      return
    }
    createCategory.mutate(payload, {
      onSuccess: () => setIsDialogOpen(false),
      onError: (error) => setFormError(toErrorMessage(error)),
    })
  }

  function openDeleteDialog(category: Category) {
    setDeleteError(null)
    setDeletingCategory(category)
  }

  function handleConfirmDelete() {
    if (!deletingCategory) return
    setDeleteError(null)
    deleteCategory.mutate(deletingCategory.id, {
      onSuccess: () => setDeletingCategory(null),
      onError: (error) => setDeleteError(toErrorMessage(error)),
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
          <p className="text-sm text-muted-foreground">Organize transactions by category</p>
        </div>
        <Button onClick={openCreateDialog}>
          <IconPlus className="h-4 w-4" />
          New category
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {categoriesQuery.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading categories...</p>
          ) : categoriesQuery.isError ? (
            <p className="p-6 text-sm text-destructive">{toErrorMessage(categoriesQuery.error)}</p>
          ) : categories.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No categories yet.</p>
          ) : (
            <ul className="divide-y">
              {flatCategories.map(({ category, depth }) => (
                <li key={category.id} className="flex items-center justify-between gap-4 px-6 py-3">
                  {/* Indent by nesting depth so a child reads as belonging to
                      the category above it. */}
                  <div className="min-w-0" style={{ paddingLeft: depth * 20 }}>
                    <p className="truncate text-sm font-medium">
                      {depth > 0 ? (
                        <span aria-hidden className="mr-1.5 text-muted-foreground">
                          &#8627;
                        </span>
                      ) : null}
                      {categoryLabel(category)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {typeLabels[category.type] ?? category.type}
                    </p>
                  </div>
                  <div className="-mr-2 flex shrink-0 gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openEditDialog(category)}
                      aria-label="Edit category"
                    >
                      <IconPencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openDeleteDialog(category)}
                      aria-label="Delete category"
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deletingCategory !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingCategory(null)
        }}
        title="Delete category?"
        description={
          deletingCategory ? `"${deletingCategory.name}" will be permanently removed.` : ''
        }
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        isPending={deleteCategory.isPending}
        errorMessage={deleteError}
      />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit category' : 'New category'}</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update the category details.' : 'Add a category for your transactions.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Name</Label>
              <Input
                id="category-name"
                value={formState.name}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-type">Type</Label>
              <Select
                value={formState.type}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, type: value }))
                }
              >
                <SelectTrigger id="category-type">
                  <SelectValue placeholder="Select a type" />
                </SelectTrigger>
                <SelectContent>
                  {categoryTypeOptions.map((typeOption) => (
                    <SelectItem key={typeOption.value} value={typeOption.value}>
                      {typeOption.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-emoji">Emoji</Label>
              <Input
                id="category-emoji"
                value={formState.emoji}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, emoji: event.target.value }))
                }
                placeholder="Optional"
                className="w-20 text-center"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-parent">Parent category</Label>
              <Select
                value={formState.parentId}
                onValueChange={(value) =>
                  setFormState((current) => ({ ...current, parentId: value }))
                }
              >
                <SelectTrigger id="category-parent">
                  <SelectValue placeholder="No parent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARENT_VALUE}>No parent</SelectItem>
                  {parentOptions.map(({ category, depth }) => (
                    <SelectItem key={category.id} value={category.id}>
                      {'\u00a0'.repeat(depth * 2)}
                      {categoryLabel(category)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={createCategory.isPending || updateCategory.isPending}
                onClick={() => setIsDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={createCategory.isPending || updateCategory.isPending}>
                {isEditing ? 'Save changes' : 'Create category'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
