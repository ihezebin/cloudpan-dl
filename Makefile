.PHONY: help pc pc\:release

help:
	@echo "make pc          Build desktop installer locally"
	@echo "make pc:release  Build desktop installer and upload GitHub Release"

pc:
	node scripts/build-pc.mjs

pc\:release:
	node scripts/build-pc.mjs --release
