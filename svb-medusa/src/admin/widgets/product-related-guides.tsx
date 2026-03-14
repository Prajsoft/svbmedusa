import { useState, useEffect, useCallback } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminProduct } from "@medusajs/types"
import {
  Button,
  Container,
  Heading,
  Input,
  Text,
  toast,
} from "@medusajs/ui"
import { PlusMini, Trash, BookOpen } from "@medusajs/icons"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugsFromMetadata(metadata: Record<string, unknown> | null | undefined): string[] {
  const raw = metadata?.relatedGuides
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string")
  return []
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

const ProductRelatedGuidesWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const [slugs, setSlugs] = useState<string[]>(() => slugsFromMetadata(data.metadata))
  const [input, setInput] = useState("")
  const [saving, setSaving] = useState(false)

  // Sync if product data reloads
  useEffect(() => {
    setSlugs(slugsFromMetadata(data.metadata))
  }, [data.metadata])

  const save = useCallback(async (nextSlugs: string[]) => {
    setSaving(true)
    try {
      const res = await fetch(`/admin/products/${data.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          metadata: { ...((data.metadata as object) ?? {}), relatedGuides: nextSlugs },
        }),
      })
      if (!res.ok) throw new Error("Save failed")
      toast.success("Related guides saved")
    } catch {
      toast.error("Failed to save — please try again")
    } finally {
      setSaving(false)
    }
  }, [data.id, data.metadata])

  const addSlug = () => {
    const trimmed = input.trim().toLowerCase().replace(/\s+/g, "-")
    if (!trimmed || slugs.includes(trimmed)) {
      setInput("")
      return
    }
    const next = [...slugs, trimmed]
    setSlugs(next)
    setInput("")
    save(next)
  }

  const removeSlug = (slug: string) => {
    const next = slugs.filter((s) => s !== slug)
    setSlugs(next)
    save(next)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      addSlug()
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <BookOpen className="text-ui-fg-subtle" />
          <Heading level="h2">Related Blog Guides</Heading>
        </div>
      </div>

      <div className="px-6 py-4 space-y-3">
        <Text size="small" className="text-ui-fg-subtle">
          Add blog post slugs (e.g. <code>how-to-choose-a-badminton-racket</code>). These will appear as "Learn more" links on the product page.
        </Text>

        {slugs.length > 0 ? (
          <ul className="space-y-2">
            {slugs.map((slug) => (
              <li key={slug} className="flex items-center justify-between rounded-md border border-ui-border-base bg-ui-bg-subtle px-3 py-2">
                <Text size="small" className="font-mono text-ui-fg-base">{slug}</Text>
                <Button
                  variant="transparent"
                  size="small"
                  onClick={() => removeSlug(slug)}
                  disabled={saving}
                  className="text-ui-fg-subtle hover:text-ui-fg-error"
                >
                  <Trash />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Text size="small" className="text-ui-fg-muted italic">
            No guides linked yet.
          </Text>
        )}

        <div className="flex gap-2 pt-1">
          <Input
            placeholder="blog-post-slug"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saving}
            className="flex-1 font-mono text-sm"
          />
          <Button
            variant="secondary"
            size="small"
            onClick={addSlug}
            disabled={saving || !input.trim()}
          >
            <PlusMini />
            Add
          </Button>
        </div>
      </div>
    </Container>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductRelatedGuidesWidget
