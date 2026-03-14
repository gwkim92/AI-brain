import { IntelligenceEventDetailModule } from "@/components/modules/intelligence/IntelligenceOperatorModule";

type EventPageProps = {
  params: Promise<{
    clusterId: string;
    eventId: string;
  }>;
};

export default async function IntelligenceEventPage({ params }: EventPageProps) {
  const { clusterId, eventId } = await params;
  return <IntelligenceEventDetailModule clusterId={clusterId} eventId={eventId} />;
}
