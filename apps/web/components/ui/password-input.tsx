'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';

/**
 * A password field with a button that shows or hides what was typed (the sign-in, sign-up and reset forms). The button
 * sits inside the field's end (left in Arabic), stays in the tab order after the field, and says what it does.
 */
export function PasswordInput({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [shown, setShown] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} className={cn('pe-10', className)} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        aria-controls={props.id}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center rounded-e-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}
