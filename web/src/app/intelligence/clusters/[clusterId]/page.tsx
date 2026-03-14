import { IntelligenceClusterDetailModule } from "@/components/modules/intelligence/IntelligenceOperatorModule";

type ClusterPageProps = {
  params: Promise<{
    clusterId: string;
  }>;
};

export default async function IntelligenceClusterPage({ params }: ClusterPageProps) {
  const { clusterId } = await params;
  return <IntelligenceClusterDetailModule clusterId={clusterId} />;
}
