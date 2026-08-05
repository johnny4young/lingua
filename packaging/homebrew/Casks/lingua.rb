cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.0.1"
  sha256 arm:   "759cc8e96efe014d1089f02eac9d7e759f58bba586b413f660c45f6509cbdf00",
         intel: "7605eacb67f9eda991d9afbeb3190a72ddc11cc80d3ab20b289d8c21e2aca7ec"

  url "https://github.com/johnny4young/lingua/releases/download/v#{version}/Lingua-#{version}-mac-#{arch}.dmg",
      verified: "github.com/johnny4young/lingua/"
  name "Lingua"
  desc "Multi-language code runner for your desktop"
  homepage "https://linguacode.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :monterey

  app "Lingua.app"

  zap trash: [
    "~/Library/Application Support/Lingua",
    "~/Library/Caches/com.lingua.app",
    "~/Library/Logs/Lingua",
    "~/Library/Preferences/com.lingua.app.plist",
    "~/Library/Saved Application State/com.lingua.app.savedState",
  ]
end
