import { useEffect, useState, type FormEvent } from 'react'
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
}

const categoryTypeOptions = ['expense', 'income']

const emptyFormState: CategoryFormState = { name: '', type: 'expense' }

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

  useEffect(() => {
    if (!isDialogOpen) return
    if (editingCategory) {
      setFormState({ name: editingCategory.name, type: editingCategory.type })
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
    if (isEditing && editingCategory) {
      updateCategory.mutate(
        { id: editingCategory.id, payload: formState },
        {
          onSuccess: () => setIsDialogOpen(false),
          onError: (error) => setFormError(toErrorMessage(error)),
        },
      )
      return
    }
    createCategory.mutate(formState, {
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
              {categories.map((category) => (
                <li key={category.id} className="flex items-center justify-between gap-4 px-6 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{category.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{category.type}</p>
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
                    <SelectItem key={typeOption} value={typeOption}>
                      {typeOption}
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
