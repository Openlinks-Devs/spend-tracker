package app.openlinks.spendtracker.ui

import app.openlinks.spendtracker.data.Category

/** A category with how deep it sits in the parent/child tree. */
data class FlatCategory(val category: Category, val depth: Int)

/**
 * Orders categories parent-first, each child directly under its parent and
 * alphabetical at every level, carrying the depth so a picker can indent.
 *
 * Two rows the API can legitimately hand us are handled rather than dropped: a
 * child whose parent is missing becomes a root, and a parent chain that loops
 * is broken by treating the offending category as a root. A picker that hangs
 * would be worse than one showing a category at the wrong level.
 */
fun flattenCategories(categories: List<Category>): List<FlatCategory> {
    val byId = categories.associateBy { category -> category.id }

    fun reachesRoot(category: Category): Boolean {
        val visited = mutableSetOf(category.id)
        var ancestorId = category.parentId
        while (ancestorId != null) {
            if (!visited.add(ancestorId)) return false
            ancestorId = byId[ancestorId]?.parentId
        }
        return true
    }

    fun parentOf(category: Category): Category? {
        val parent = category.parentId?.let { parentId -> byId[parentId] }
        if (parent == null || parent.id == category.id || !reachesRoot(category)) return null
        return parent
    }

    val childrenByParentId = categories.groupBy { category -> parentOf(category)?.id }
    val flattened = mutableListOf<FlatCategory>()

    fun visit(parentId: String?, depth: Int) {
        childrenByParentId[parentId]
            .orEmpty()
            .sortedBy { category -> category.name.lowercase() }
            .forEach { category ->
                flattened += FlatCategory(category, depth)
                visit(category.id, depth + 1)
            }
    }

    visit(null, 0)
    return flattened
}

/** Display name with the category's emoji in front, when it has one. */
fun categoryLabel(category: Category): String =
    category.emoji?.takeIf { emoji -> emoji.isNotBlank() }?.let { emoji -> "$emoji ${category.name}" }
        ?: category.name

/**
 * Picker options (id to label) with children indented under their parent. The
 * dropdown renders plain text, so the nesting has to live in the label itself.
 */
fun categoryPickerOptions(categories: List<Category>): List<Pair<String, String>> =
    flattenCategories(categories).map { (category, depth) ->
        val indent = "    ".repeat(depth)
        category.id to indent + categoryLabel(category)
    }

/** Chip label: chips wrap in a flow row, so nesting is marked, not indented. */
fun categoryChipLabel(flat: FlatCategory): String =
    if (flat.depth > 0) "↳ " + categoryLabel(flat.category) else categoryLabel(flat.category)
