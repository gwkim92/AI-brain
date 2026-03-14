import { IntelligenceExecutionDetailModule } from "@/components/modules/intelligence/IntelligenceOperatorModule";

type ExecutionPageProps = {
  params: Promise<{
    clusterId: string;
    eventId: string;
    candidateId: string;
  }>;
};

export default async function IntelligenceExecutionPage({ params }: ExecutionPageProps) {
  const { clusterId, eventId, candidateId } = await params;
  return (
    <IntelligenceExecutionDetailModule
      clusterId={clusterId}
      eventId={eventId}
      candidateId={candidateId}
    />
  );
}
