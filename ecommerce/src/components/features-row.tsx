import { BoxIcon, ChatIcon, TruckIcon, WalletIcon } from "./icons";

// What the shop actually promises: every line here is how ordering works today.
const FEATURES = [
  { Icon: BoxIcon, title: "Live showroom stock", text: "Availability comes straight from our showroom." },
  { Icon: WalletIcon, title: "No payment online", text: "Send a request first. Pay once we confirm." },
  { Icon: ChatIcon, title: "We call to confirm", text: "We check stock, price and timing with you." },
  { Icon: TruckIcon, title: "Delivery arranged with you", text: "Address and date agreed on the phone." },
];

export function FeaturesRow({ tone = "light" }: { tone?: "light" | "cream" }) {
  return (
    <section aria-label="Why order from us" className={tone === "cream" ? "bg-cream" : "bg-white"}>
      <ul className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-8 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ Icon, title, text }) => (
          <li key={title} className="flex items-start gap-4">
            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-brand-darker text-gold">
              <Icon className="h-6 w-6" />
            </span>
            <div>
              <h3 className="font-sans text-[15px] font-semibold">{title}</h3>
              <p className="mt-0.5 text-sm text-muted">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
