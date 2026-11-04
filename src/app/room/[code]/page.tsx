import { notFound } from "next/navigation";
import SpriteRushGame from "@/components/SpriteRushGame";
import { isRoomCode, normalizeRoomCode } from "@/lib/protocol";

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const roomCode = normalizeRoomCode(code);
  if (!isRoomCode(roomCode)) notFound();
  return <SpriteRushGame roomCode={roomCode} />;
}
