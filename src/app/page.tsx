import SpriteRushGame from "@/components/SpriteRushGame";

export default function Home() {
  // Read on the server; only the room server's address reaches the browser (it has to, to connect).
  return <SpriteRushGame partyHost={process.env.PUBLIC_PARTY_HOST || null} />;
}
