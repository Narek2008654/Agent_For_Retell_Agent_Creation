import { render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";

test("Button renders with text", () => {
  render(<Button>Hi</Button>);
  expect(screen.getByText("Hi")).toBeInTheDocument();
});
