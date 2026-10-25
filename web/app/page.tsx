import { Manrope } from "next/font/google";
import { LandingPage } from "@/components/landing/LandingPage";
import "./landing.css";

const landingFont = Manrope({
  subsets: ["latin"],
  variable: "--font-landing",
  display: "swap",
});

export default function Home() {
  return (
    <div className={landingFont.variable}>
      <LandingPage />
    </div>
  );
}
