package app.openlinks.spendtracker

import app.openlinks.spendtracker.data.Category
import app.openlinks.spendtracker.ui.categoryChipLabel
import app.openlinks.spendtracker.ui.categoryLabel
import app.openlinks.spendtracker.ui.categoryPickerOptions
import app.openlinks.spendtracker.ui.flattenCategories
import org.junit.Assert.assertEquals
import org.junit.Test

private fun category(
    id: String,
    name: String,
    parentId: String? = null,
    emoji: String? = null,
) = Category(id = id, name = name, type = "out", parentId = parentId, emoji = emoji)

class CategoryTreeTest {
    private val categories = listOf(
        category("transport", "Transporte"),
        category("taxi", "Taxi", parentId = "transport", emoji = "🚕"),
        category("bus", "Bus", parentId = "transport"),
        category("home", "Hogar"),
    )

    @Test
    fun `orders children under their parent, alphabetically at each level`() {
        assertEquals(
            listOf("Hogar" to 0, "Transporte" to 0, "Bus" to 1, "Taxi" to 1),
            flattenCategories(categories).map { flat -> flat.category.name to flat.depth },
        )
    }

    @Test
    fun `nests to any depth`() {
        val deep = listOf(
            category("a", "A"),
            category("b", "B", parentId = "a"),
            category("c", "C", parentId = "b"),
        )
        assertEquals(listOf(0, 1, 2), flattenCategories(deep).map { flat -> flat.depth })
    }

    @Test
    fun `promotes a child whose parent is missing to a root`() {
        val orphan = listOf(category("orphan", "Orphan", parentId = "gone"))
        assertEquals(listOf("Orphan" to 0), flattenCategories(orphan).map { it.category.name to it.depth })
    }

    @Test
    fun `keeps every category when the parent links form a cycle`() {
        val looped = listOf(category("a", "A", parentId = "b"), category("b", "B", parentId = "a"))
        assertEquals(2, flattenCategories(looped).size)
    }

    @Test
    fun `picker options indent children and prefix the emoji`() {
        assertEquals(
            listOf(
                "home" to "Hogar",
                "transport" to "Transporte",
                "bus" to "    Bus",
                "taxi" to "    🚕 Taxi",
            ),
            categoryPickerOptions(categories),
        )
    }

    @Test
    fun `chip label marks a child instead of indenting it`() {
        val flattened = flattenCategories(categories).associateBy { flat -> flat.category.id }
        assertEquals("🚕 Taxi", categoryLabel(flattened.getValue("taxi").category))
        assertEquals("↳ 🚕 Taxi", categoryChipLabel(flattened.getValue("taxi")))
        assertEquals("Transporte", categoryChipLabel(flattened.getValue("transport")))
    }
}
