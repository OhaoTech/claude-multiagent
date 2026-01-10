import { useState, useRef } from 'react'
import { Image, X } from 'lucide-react'

interface ImageAttachmentProps {
  images: string[]
  onImagesChange: (images: string[]) => void
}

export function ImageAttachment({ images, onImagesChange }: ImageAttachmentProps) {
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = (files: FileList | null) => {
    if (!files) return

    const newImages: string[] = [...images]

    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return
      if (newImages.length >= 4) return // Max 4 images

      const reader = new FileReader()
      reader.onload = (e) => {
        const base64 = e.target?.result as string
        newImages.push(base64)
        onImagesChange([...newImages])
      }
      reader.readAsDataURL(file)
    })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const removeImage = (index: number) => {
    const newImages = images.filter((_, i) => i !== index)
    onImagesChange(newImages)
  }

  return (
    <div className="space-y-2">
      {/* Preview area */}
      {images.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {images.map((img, idx) => (
            <div key={idx} className="relative group">
              <img
                src={img}
                alt={`Attachment ${idx + 1}`}
                className="w-16 h-16 object-cover rounded border border-[var(--border)]"
              />
              <button
                onClick={() => removeImage(idx)}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload button/drop area */}
      {images.length < 4 && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`flex items-center gap-2 ${isDragging ? 'opacity-70' : ''}`}
        >
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] border border-[var(--border)] transition-colors text-xs"
          >
            <Image size={12} />
            <span>{isDragging ? 'Drop here' : 'Add Image'}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
          <span className="text-xs text-[var(--text-secondary)]">
            {4 - images.length} remaining
          </span>
        </div>
      )}
    </div>
  )
}
