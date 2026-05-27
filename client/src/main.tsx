import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ClerkProvider,
  RedirectToSignIn,
  SignedIn,
  SignedOut,
} from "@clerk/clerk-react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { Login } from "@/pages/Login";
import { Signup } from "@/pages/Signup";
import { Chat } from "@/pages/Chat";
import { Memory } from "@/pages/Memory";
import { Calls } from "@/pages/Calls";
import "./index.css";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

const queryClient = new QueryClient();

function Protected({ children }: { children: ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/login/*" element={<Login />} />
              <Route path="/signup/*" element={<Signup />} />
              <Route path="/" element={<Protected><Chat /></Protected>} />
              <Route path="/memory" element={<Protected><Memory /></Protected>} />
              <Route path="/calls" element={<Protected><Calls /></Protected>} />
              <Route path="/calls/:id" element={<Protected><Calls /></Protected>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          <Toaster />
        </QueryClientProvider>
      </ClerkProvider>
    </ThemeProvider>
  </StrictMode>,
);
