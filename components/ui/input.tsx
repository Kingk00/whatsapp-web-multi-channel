import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const inputVariants = cva(
  "flex w-full text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-fast",
  {
    variants: {
      variant: {
        default:
          "h-10 rounded-md border border-input bg-background px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        search:
          "h-10 rounded-full border-0 bg-muted/50 px-4 pl-10 focus:bg-muted focus:ring-0",
        ghost:
          "h-10 rounded-md border-0 bg-transparent px-3 py-2 hover:bg-muted/50 focus:bg-muted",
      },
      inputSize: {
        default: "h-10",
        sm: "h-9 text-xs",
        lg: "h-12 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      inputSize: "default",
    },
  }
)

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  icon?: React.ReactNode
  iconPosition?: 'left' | 'right'
  onClear?: () => void
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant, inputSize, icon, iconPosition = 'left', onClear, value, ...props }, ref) => {
    const hasValue = value !== undefined && value !== ''

    return (
      <div className="relative w-full">
        {/* Left icon */}
        {icon && iconPosition === 'left' && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            {icon}
          </div>
        )}

        <input
          type={type}
          value={value}
          className={cn(
            inputVariants({ variant, inputSize }),
            icon && iconPosition === 'left' && 'pl-10',
            icon && iconPosition === 'right' && 'pr-10',
            onClear && hasValue && 'pr-10',
            className
          )}
          ref={ref}
          {...props}
        />

        {/* Right icon or clear button */}
        {icon && iconPosition === 'right' && !onClear && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
            {icon}
          </div>
        )}

        {/* Clear button */}
        {onClear && hasValue && (
          <button
            type="button"
            onClick={onClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    )
  }
)
Input.displayName = "Input"

// Search Input - convenience wrapper
interface SearchInputProps extends Omit<InputProps, 'variant' | 'icon' | 'iconPosition'> {
  onClear?: () => void
}

const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ placeholder = "Search...", ...props }, ref) => {
    return (
      <Input
        ref={ref}
        variant="search"
        placeholder={placeholder}
        icon={
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        }
        iconPosition="left"
        {...props}
      />
    )
  }
)
SearchInput.displayName = "SearchInput"

export { Input, SearchInput, inputVariants }
