mod connection {
    pub struct ConnectionEngine;
    impl ConnectionEngine {
        pub fn shutdown(&self) {}
        pub async fn drain(&self) {}
    }
}
#[path = "../src/updates.rs"]
mod updates;
