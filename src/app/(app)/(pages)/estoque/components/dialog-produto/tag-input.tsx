"use client"

import * as React from "react"
import { X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface TagInputProps {
  value?: string[]
  onChange?: (tags: string[]) => void
  placeholder?: string
  className?: string
}

export function TagInput({
  value = [],
  onChange,
  placeholder = "Digite e pressione espaço...",
  className,
}: TagInputProps) {
  const [tags, setTags] = React.useState<string[]>(value)
  const [inputValue, setInputValue] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    setTags(value)
  }, [value])

  const addTag = (tag: string) => {
    const trimmedTag = tag.trim()
    if (trimmedTag && !tags.includes(trimmedTag)) {
      const newTags = [...tags, trimmedTag]
      setTags(newTags)
      onChange?.(newTags)
    }
  }

  const removeTag = (tagToRemove: string) => {
    const newTags = tags.filter((tag) => tag !== tagToRemove)
    setTags(newTags)
    onChange?.(newTags)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value

    // Check if user typed a space
    if (value.endsWith(" ")) {
      const newTag = value.slice(0, -1).trim()
      if (newTag) {
        addTag(newTag)
      }
      setInputValue("")
    } else {
      setInputValue(value)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace to delete last tag when input is empty
    if (e.key === "Backspace" && inputValue === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1])
    }

    // Also handle Enter to add tag
    if (e.key === "Enter") {
      e.preventDefault()
      const trimmed = inputValue.trim()
      if (trimmed) {
        addTag(trimmed)
        setInputValue("")
      }
    }
  }

  const handleContainerClick = () => {
    inputRef.current?.focus()
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pastedText = e.clipboardData.getData("text")
    const pastedTags = pastedText.split(/\s+/).filter((tag) => tag.trim() !== "")
    
    if (pastedTags.length > 0) {
      const newTags = [...tags]
      for (const tag of pastedTags) {
        const trimmedTag = tag.trim()
        if (trimmedTag && !newTags.includes(trimmedTag)) {
          newTags.push(trimmedTag)
        }
      }
      setTags(newTags)
      onChange?.(newTags)
      setInputValue("")
    }
  }

  return (
    <div
      onClick={handleContainerClick}
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        className
      )}
    >
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1 bg-primary hover:cursor-default text-primary-foreground">
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              removeTag(tag)
            }}
            className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20 focus:outline-none hover:cursor-pointer"
            aria-label={`Remover tag ${tag}`}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        ref={inputRef}
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="h-7 min-w-[120px] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
