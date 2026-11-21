# Screenloop 진입점. push 전에는 `make verify` 가 0 으로 끝나야 한다.
.PHONY: up down test test-unit test-int contract e2e spec verify pages demo-build domain-js

# 5분 실행: 이미지 빌드 → compose 로 전체 구성 기동 (운영 웹 http://127.0.0.1:59681, 플레이어 http://127.0.0.1:59682/?device=d-001)
up:
	bash scripts/build-images.sh
	docker compose up -d --no-build --wait
	@echo ""
	@echo "구성이 올라왔습니다."
	@echo "  운영 웹   http://127.0.0.1:59681   (operator / operator-demo, 보기 전용 viewer / viewer-demo)"
	@echo "  플레이어  http://127.0.0.1:59682/?device=d-001   (d-001 ~ d-004)"
	@echo "  서버 API  http://127.0.0.1:59680/api/version"

down:
	docker compose down -v --remove-orphans

# 명세에서 이벤트 스키마와 TS 타입을 다시 만든다
spec:
	node scripts/spec-export.mjs

# 단위(TS: sync-core·플레이어·웹 헬퍼, Kotlin: 순수 도메인 벡터) + 계약 + 통합(실제 PostgreSQL·Redis, Docker 필요)
test: test-unit contract test-int

test-unit: domain-js
	npm run test -w @screenloop/sync-core -w @screenloop/web
	bash scripts/gradle.sh :domain:jvmTest :domain:jsNodeTest --console=plain

contract:
	bash scripts/gradle.sh :server:test --tests '*ContractIT' --console=plain

test-int:
	bash scripts/gradle.sh :server:test --tests '*CommandIT' --tests '*RecordsAndBillingIT' --tests '*MigrationTest' --console=plain

# compose 전체 구성을 올려 Playwright 로 운영 웹·플레이어 두 대·끊김·정산·배포 되돌리기를 시험한다
e2e:
	bash scripts/e2e.sh

# 서버 도메인(Kotlin)을 JS 로 컴파일한다(데모 사이트와 sync-core 시험이 쓴다)
domain-js:
	bash scripts/build-domain-js.sh

demo-build: domain-js
	node web-demo/build.mjs

verify:
	bash scripts/verify.sh

# 데모 사이트를 gh-pages 브랜치에 로컬 커밋한다(push 는 하지 않는다).
pages:
	bash scripts/deploy-pages.sh
