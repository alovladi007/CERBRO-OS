# Ports

Cerebro OS uses the **4700 block**, which no other platform on the host machine uses. Every binding is to `127.0.0.1` by default.

| Port | Use |
|---|---|
| 4700 | Cerebro OS server (`npm start`, Docker, docker-compose) |
| 4701 | Development server (`npm run dev`) |
| 4702 | Optional static nginx edge (`docker compose --profile nginx`) |

Docker compose publishes fixed ports only. It never uses random ephemeral host ports, which could land on reserved ports such as 55434, 56381 or 58000.

## Reserved by other local platforms — never use

`tests/ports.test.mjs` fails if any of these ports appear in Cerebro OS configuration, scripts or docs.

- **Web apps:** 3010, 4040, 4041, 4100, 4200, 4300, 4400, 4500, 4600
- **App back ends:** 8000, 8004, 8005, 8010–8015, 8021–8023, 8030, 8040, 8050, 8060, 8080, 8090, 8100, 8110, 8120, 8200, 8300, 8400, 8500, 8600, 8800
- **Databases and caches:** 5434, 5441, 5442, 5443, 5445, 6381, 6392, 6393, 6394
- **Infrastructure:** 9004, 9005, 9092, 29092, 9250, 9650, 7474, 7687, 6333, 16686, 4317, 4318
- **On demand:** 55434, 56381, 58000, 3100, 9100

Before adding a new port, check this list and add the new port to the table above.
