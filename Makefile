IMAGE = dwa-dev
DOCKER = docker run --rm -v "$$(pwd)":/workspace -w /workspace $(IMAGE)

.PHONY: image install dev build compile clean

image:
	docker build -t $(IMAGE) -f Dockerfile.dev .

install: image
	$(DOCKER) npm install

dev: image
	docker run --rm -it -p 5173:5173 -v "$$(pwd)":/workspace -w /workspace $(IMAGE) npm run dev

build: image
	$(DOCKER) npm run build

compile: image
	$(DOCKER) npm run compile

clean:
	rm -rf node_modules dist
