# Homebrew Distribution

## Setting up the Homebrew tap

1. Create a GitHub repository: `homebrew-wst`
2. Add a formula file `Formula/wst.rb`:

```ruby
class Wst < Formula
  desc "Wan Shi Tong CLI - Architecture knowledge search"
  homepage "https://github.com/<org>/wanshitong"
  url "https://github.com/<org>/wanshitong/releases/download/v#{version}/wst-bundle.cjs"
  sha256 "<sha256>"
  license "MIT"

  depends_on "node"

  def install
    bin.install "wst-bundle.cjs" => "wst"
  end
end
```

## Installation

```bash
brew tap <org>/wst
brew install wst
```

## Updating

The `deploy-cli` GitHub Action automatically updates the formula SHA and URL on each release.
