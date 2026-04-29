import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '../../lib/utils';

const RadioGroup = RadioGroupPrimitive.Root;

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        'data-[state=unchecked]:border-muted-foreground/40',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex h-full w-full items-center justify-center">
        <span className="block h-full w-full rounded-full border-2 border-surface" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
