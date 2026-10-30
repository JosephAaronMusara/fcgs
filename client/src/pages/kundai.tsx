import { Bot } from "lucide-react";

export default function KundAiPage() {
  return (
    <div className="flex items-center justify-center min-h-[80vh] p-6">
      <div className="max-w-lg text-center space-y-6">
        <Bot className="w-16 h-16 mx-auto text-primary" />
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-kundai-title">Kund-Ai</h1>
        <div className="text-base leading-relaxed text-muted-foreground space-y-4" data-testid="text-kundai-story">
          <p>
            Kundai is a name inspired by Misheck Mujeyi. It is a Shona name associated with excellence. In Misheck's case, he calls himself Kundai for being such an excellent Pool/Snooker player and we have accepted this name of his. We love the name and we want the name too for our Ai Chatbot.
          </p>
          <p>
            We wonder what Mr. L. Ziko thinks about Kundai...
          </p>
        </div>
      </div>
    </div>
  );
}
