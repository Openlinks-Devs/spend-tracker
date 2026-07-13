import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface CurrencySwitcherProps {
  currencies: string[]
  value: string
  onChange: (currency: string) => void
}

export function CurrencySwitcher({ currencies, value, onChange }: CurrencySwitcherProps) {
  if (currencies.length <= 1) {
    return null
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-32">
        <SelectValue placeholder="Currency" />
      </SelectTrigger>
      <SelectContent>
        {currencies.map((currency) => (
          <SelectItem key={currency} value={currency}>
            {currency}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
