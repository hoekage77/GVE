import * as React from "react";

import { cn } from "../../lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">): React.ReactElement {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}

export { Label };
