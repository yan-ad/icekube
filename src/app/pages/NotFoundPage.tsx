import { useNavigate } from "@tanstack/react-router";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";

export default function NotFoundPage() {
  const navigate = useNavigate();
  return <VStack padding={6} gap={4}>
    <Heading level={1}>Page not found</Heading>
    <Text>This destination is not part of Icekube.</Text>
    <Button label="Go to Welcome Page" onClick={() => void navigate({ to: "/" })} />
  </VStack>;
}
