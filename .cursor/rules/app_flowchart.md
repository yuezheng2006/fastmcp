flowchart TD
    A[Initialization: Server initializes with name, version and optional authentication] --> B[Configuration: Add Tools, Resources, Prompts]
    B --> C[Server Start: Start server using stdio or sse transport]
    C --> D[Client Connection: Create session, emit onConnect event, perform authentication]
    D --> E[Client Requests: Send requests such as ListTools, CallTool, ListResources, ReadResource, GetPrompt, Complete, SetLevel]
    E --> F[Server Processing: Validate input and execute logic]
    F --> G[Real-time Updates: Send progress and logs via SSE]
    G --> H[Client Disconnection: Emit onClose event and clean up session]
    H --> I[Server Stop: Close connections and release resources]